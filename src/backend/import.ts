import type { Router } from "express";
import type {
  PluginContext,
  PluginHostCreateInput,
  PluginHostRecord,
  PluginHostUpdateInput,
} from "@termix-ssh/plugin-sdk/backend";
import type { PveClient } from "./pve/client.js";
import {
  agentEnabled,
  osFromAgent,
  osFromConfig,
  probeRuntimes,
  type GuestOs,
  type GuestRuntimes,
} from "./guest-probe.js";
import { SETTINGS, withPveClient } from "./pve/connection.js";
import { parseHostId, sendError } from "./routes.js";

/** Host setting keys of the import, declared in manifest.json. */
export const IMPORT_SETTINGS = {
  /** On an imported guest: where it came from. */
  source: "pveSource",
  /** On the node: what new guests get, saved by the import dialog. */
  defaults: "pveImportDefaults",
  /** On the node: the last sync. */
  state: "pveImportState",
  sync: "pveImportSync",
  interval: "pveImportInterval",
  addNew: "pveImportAddNew",
} as const;

export const MISSING_TAG = "proxmox-missing";
const MIN_INTERVAL_MINUTES = 5;
const DEFAULT_INTERVAL_MINUTES = 15;
const IP_CONCURRENCY = 4;

export type GuestType = "qemu" | "lxc";

export interface DiscoveredGuest {
  type: GuestType;
  vmid: number;
  name: string;
  node: string;
  status: string;
  ip: string | null;
  os: GuestOs;
  /** Docker and Podman inside, when the import dialog asked; null when unknown. */
  runtimes?: GuestRuntimes | null;
}

export interface GuestSource {
  sourceHostId: number;
  type: GuestType;
  vmid: number;
  node: string;
  lastSeenAt: string;
  lastStatus: string;
  missingSince: string | null;
}

/** How Termix reaches a new guest. RDP and VNC are the remote-desktop plugin's. */
export type GuestConnection = "ssh" | "rdp" | "vnc";
export const CONNECTIONS: readonly GuestConnection[] = ["ssh", "rdp", "vnc"];
const PORTS: Record<GuestConnection, number> = {
  ssh: 22,
  rdp: 3389,
  vnc: 5900,
};
const REMOTE_DESKTOP = "remote-desktop";
const DOCKER = "docker";

/**
 * How new guests sign in: the node's own credential (SSH only), a saved
 * credential, a bare username, or nothing.
 */
export interface ImportLogin {
  mode: "node" | "credential" | "username" | "none";
  credentialId: number | null;
  username: string;
}

export interface ImportDefaults {
  /** Empty puts guests in a folder named after the node. */
  folder: string;
  ssh: ImportLogin;
  /** RDP and VNC guests. */
  desktop: ImportLogin;
}

export interface SyncResult {
  created: number;
  updated: number;
  markedMissing: number;
  errors: string[];
  /** The Termix hosts created now, by guest key. */
  hosts: Record<string, number>;
}

export const guestKey = (g: { type: string; vmid: number }) =>
  `${g.type}:${g.vmid}`;

const skipIp = (ip: string) =>
  ip.startsWith("127.") || ip.startsWith("169.254.");
const IPV4 = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/\d{1,2})?$/;

/** The first static IPv4 in net*= (containers) or ipconfig*= (cloud-init) lines. */
export function configIp(config: Record<string, unknown>): string | null {
  const keys = Object.keys(config)
    .filter((k) => /^(net|ipconfig)\d+$/.test(k))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const key of keys) {
    const match = String(config[key]).match(/(?:^|,)ip=([^,]+)/);
    const ip = match?.[1].match(IPV4)?.[1];
    if (ip && !skipIp(ip)) return ip;
  }
  return null;
}

/** The first IPv4 a running guest reports: /interfaces for containers, the agent for VMs. */
export function liveIp(type: GuestType, data: unknown): string | null {
  if (type === "lxc") {
    for (const iface of Array.isArray(data) ? data : []) {
      const entry = iface as { name?: string; inet?: string };
      if (entry.name === "lo") continue;
      const ip = entry.inet?.match(IPV4)?.[1];
      if (ip && !skipIp(ip)) return ip;
    }
    return null;
  }
  const result = (data as { result?: unknown })?.result;
  for (const iface of Array.isArray(result) ? result : []) {
    const entry = iface as {
      name?: string;
      "ip-addresses"?: Array<Record<string, string>>;
    };
    if (entry.name === "lo") continue;
    for (const addr of entry["ip-addresses"] ?? []) {
      const ip = addr["ip-address"];
      if (addr["ip-address-type"] === "ipv4" && ip && !skipIp(ip)) return ip;
    }
  }
  return null;
}

async function resolveGuest(
  client: PveClient,
  base: Omit<DiscoveredGuest, "ip" | "os">,
): Promise<DiscoveredGuest> {
  const path = ["nodes", base.node, base.type, base.vmid];
  const config = await client
    .request<Record<string, unknown>>({ path: [...path, "config"] })
    .catch(() => ({}) as Record<string, unknown>);
  let os = osFromConfig(base.type, config);
  if (
    base.type === "qemu" &&
    base.status === "running" &&
    agentEnabled(config)
  ) {
    const info = await client
      .request({ path: [...path, "agent", "get-osinfo"], timeoutMs: 10000 })
      .catch(() => null);
    os = osFromAgent(info) ?? os;
  }
  let ip = configIp(config);
  if (!ip && base.status === "running") {
    const live =
      base.type === "lxc"
        ? [...path, "interfaces"]
        : [...path, "agent", "network-get-interfaces"];
    ip = liveIp(
      base.type,
      await client.request({ path: live, timeoutMs: 10000 }).catch(() => null),
    );
  }
  return { ...base, ip, os };
}

/** Every VM and container in the cluster, templates left out, with an address when one is known. */
export async function discoverGuests(
  client: PveClient,
): Promise<DiscoveredGuest[]> {
  const resources = await client.request<Array<Record<string, unknown>>>({
    path: ["cluster", "resources"],
    params: { type: "vm" },
  });
  const bases = (resources ?? [])
    .filter((r) => (r.type === "qemu" || r.type === "lxc") && !r.template)
    .map((r) => ({
      type: r.type as GuestType,
      vmid: Number(r.vmid),
      name: String(r.name || r.vmid),
      node: String(r.node),
      status: String(r.status ?? "unknown"),
    }))
    .sort((a, b) => a.vmid - b.vmid);

  // A few at a time: pvesh calls are heavy on a small node.
  const out: DiscoveredGuest[] = new Array(bases.length);
  let next = 0;
  const worker = async () => {
    while (next < bases.length) {
      const i = next++;
      out[i] = await resolveGuest(client, bases[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(IP_CONCURRENCY, bases.length) }, worker),
  );
  return out;
}

export function parseSource(value: unknown): GuestSource | null {
  const v = (value ?? {}) as Record<string, unknown>;
  if (
    typeof v.sourceHostId !== "number" ||
    (v.type !== "qemu" && v.type !== "lxc") ||
    typeof v.vmid !== "number"
  ) {
    return null;
  }
  return v as unknown as GuestSource;
}

/** "a / b/" → "a/b": core keeps nested folders as one path joined by "/". */
export function normalizeFolder(value: string): string {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

const LOGIN_MODES = ["node", "credential", "username", "none"] as const;
const NO_LOGIN: ImportLogin = {
  mode: "none",
  credentialId: null,
  username: "",
};

function parseLogin(
  value: unknown,
  fallback: ImportLogin,
  allowNode: boolean,
): ImportLogin {
  if (!value || typeof value !== "object") return fallback;
  const v = value as Record<string, unknown>;
  const mode = LOGIN_MODES.find((m) => m === v.mode);
  const id = Number(v.credentialId);
  const credentialId = Number.isInteger(id) && id > 0 ? id : null;
  const username = typeof v.username === "string" ? v.username.trim() : "";
  if (!mode || (mode === "node" && !allowNode)) return fallback;
  if (mode === "credential" && !credentialId) return fallback;
  if (mode === "username" && !username) return fallback;
  return {
    mode,
    credentialId: mode === "credential" ? credentialId : null,
    username: mode === "username" ? username : "",
  };
}

export function parseDefaults(value: unknown): ImportDefaults {
  const v = (value ?? {}) as Record<string, unknown>;
  // Saved before 0.2.5: one username and a node credential switch.
  const legacyUser =
    typeof v.username === "string" && v.username.trim()
      ? v.username.trim()
      : "root";
  const sshFallback: ImportLogin =
    v.useNodeCredential === false
      ? { mode: "username", credentialId: null, username: legacyUser }
      : { mode: "node", credentialId: null, username: "" };
  return {
    folder: typeof v.folder === "string" ? normalizeFolder(v.folder) : "",
    ssh: parseLogin(v.ssh, sshFallback, true),
    desktop: parseLogin(v.desktop, NO_LOGIN, false),
  };
}

/** Saved credentials the defaults point at, to check they are the user's. */
export function defaultsCredentialIds(defaults: ImportDefaults): number[] {
  return [defaults.ssh, defaults.desktop].flatMap((l) =>
    l.mode === "credential" && l.credentialId ? [l.credentialId] : [],
  );
}

/** Windows over RDP, everything else over SSH. */
export function defaultConnection(guest: { os: GuestOs }): GuestConnection {
  return guest.os.family === "windows" ? "rdp" : "ssh";
}

export type ContainerRuntime = "docker" | "podman";

/** What the user picked for one guest in the import dialog. */
export interface GuestChoice {
  connection?: GuestConnection;
  /** Turns on the Docker plugin for the new host with this runtime. */
  runtime?: ContainerRuntime | null;
}

/** The runtime to suggest: Docker when both are there. */
export function suggestedRuntime(
  runtimes: GuestRuntimes | null | undefined,
): ContainerRuntime | null {
  return runtimes?.docker ? "docker" : runtimes?.podman ? "podman" : null;
}

export function splitTags(tags: unknown): string[] {
  const list = Array.isArray(tags) ? tags : String(tags ?? "").split(",");
  return list.map((t) => String(t).trim()).filter(Boolean);
}

export function mergeTags(
  existing: unknown,
  add: string[],
  remove: string[] = [],
): string {
  const drop = new Set(remove);
  return [...new Set([...splitTags(existing), ...add])]
    .filter((t) => !drop.has(t))
    .join(",");
}

export function guestTags(g: DiscoveredGuest): string[] {
  return [
    "proxmox",
    g.type,
    g.node,
    `${g.type === "lxc" ? "ct" : "vm"}-${g.vmid}`,
  ];
}

export interface ImportedHost {
  host: PluginHostRecord;
  source: GuestSource;
}

/** The acting user's hosts imported from one node, by guest key. */
export function indexImported(
  hosts: PluginHostRecord[],
  sources: Array<{ hostId: number; value: unknown }>,
  sourceHostId: number,
): Map<string, ImportedHost> {
  const byId = new Map(hosts.map((h) => [h.id, h]));
  const out = new Map<string, ImportedHost>();
  for (const { hostId, value } of sources) {
    const host = byId.get(hostId);
    const source = parseSource(value);
    if (host && source?.sourceHostId === sourceHostId) {
      out.set(guestKey(source), { host, source });
    }
  }
  return out;
}

/** The SSH sign-in of a new guest. */
function sshLogin(
  login: ImportLogin,
  node: PluginHostRecord,
): Pick<PluginHostCreateInput, "username" | "authType" | "credentialId"> {
  const credentialId =
    login.mode === "credential"
      ? login.credentialId
      : login.mode === "node" && node.authType === "credential"
        ? (node.credentialId ?? null)
        : null;
  if (credentialId) {
    return { username: "", authType: "credential", credentialId };
  }
  return {
    // A node that signs in some other way lends guests its username.
    username:
      login.mode === "username"
        ? login.username
        : login.mode === "node"
          ? node.username || "root"
          : "",
    authType: "none",
    credentialId: null,
  };
}

/** The host a new guest becomes. */
export function newGuestHost(
  pluginId: string,
  guest: DiscoveredGuest,
  source: GuestSource,
  node: PluginHostRecord,
  defaults: ImportDefaults,
  choice: GuestChoice = {},
): PluginHostCreateInput {
  const connection = choice.connection ?? defaultConnection(guest);
  const common = {
    name: guest.name,
    ip: guest.ip ?? "0.0.0.0",
    port: PORTS[connection],
    connectionType: connection,
    folder: defaults.folder || node.name || "Proxmox",
    tags: guestTags(guest).join(","),
    pin: false,
    jumpHosts: node.jumpHosts ?? [],
  };
  const own = { [pluginId]: { [IMPORT_SETTINGS.source]: source } };
  if (connection === "ssh") {
    const runtime = choice.runtime ?? null;
    return {
      ...common,
      ...sshLogin(defaults.ssh, node),
      ...(runtime ? { tags: [...guestTags(guest), runtime].join(",") } : {}),
      enableSsh: true,
      pluginSettings: runtime
        ? { ...own, [DOCKER]: { containerRuntime: runtime } }
        : own,
      ...(runtime ? { pluginEnable: { [DOCKER]: true } } : {}),
    };
  }
  const login = defaults.desktop;
  const flag = connection === "rdp" ? "enableRdp" : "enableVnc";
  return {
    ...common,
    username: "",
    authType: "none",
    credentialId: null,
    enableSsh: false,
    pluginSettings: {
      ...own,
      [REMOTE_DESKTOP]: {
        [flag]: true,
        [`${connection}Port`]: PORTS[connection],
      },
    },
    protocolAuth: {
      [connection]:
        login.mode === "credential"
          ? { authType: "credential", credentialId: login.credentialId }
          : login.mode === "username"
            ? { authType: "direct", username: login.username }
            : { authType: "none" },
    },
  };
}

const running = new Set<number>();

/**
 * Brings the hosts imported from a node up to date, as the acting user.
 * `create` names guests to add now; with none given, new guests are added
 * only when the node is set to add them.
 */
export async function syncNode(
  ctx: PluginContext,
  sourceHostId: number,
  options: {
    /** Guests to add now, by guest key, with how to reach each when given. */
    create?: Map<string, GuestChoice>;
    defaults?: ImportDefaults;
    /** Stands in for the node in tests. */
    discover?: () => Promise<DiscoveredGuest[]>;
  } = {},
): Promise<SyncResult> {
  if (running.has(sourceHostId)) {
    throw Object.assign(new Error("A sync of this node is already running"), {
      status: 409,
    });
  }
  running.add(sourceHostId);
  const result: SyncResult = {
    created: 0,
    updated: 0,
    markedMissing: 0,
    errors: [],
    hosts: {},
  };
  const startedAt = new Date().toISOString();
  try {
    const guests = await (options.discover?.() ??
      withPveClient(ctx, sourceHostId, discoverGuests));
    const owned = await ctx.hosts.listOwned();
    const node = owned.find((h) => h.id === sourceHostId);
    if (!node) {
      throw Object.assign(
        new Error("Only the node's owner can import its guests"),
        {
          status: 403,
        },
      );
    }
    const defaults =
      options.defaults ??
      parseDefaults(
        await ctx.settings.getHost(sourceHostId, IMPORT_SETTINGS.defaults),
      );
    const addNew =
      options.create === undefined &&
      (await ctx.settings.getHost<boolean>(
        sourceHostId,
        IMPORT_SETTINGS.addNew,
      )) === true;
    const imported = indexImported(
      owned,
      await ctx.settings.listHostValues(IMPORT_SETTINGS.source),
      sourceHostId,
    );
    const now = new Date().toISOString();
    const seen = new Set<string>();

    for (const guest of guests) {
      const key = guestKey(guest);
      seen.add(key);
      const existing = imported.get(key);
      const source: GuestSource = {
        sourceHostId,
        type: guest.type,
        vmid: guest.vmid,
        node: guest.node,
        lastSeenAt: now,
        lastStatus: guest.status,
        missingSince: null,
      };
      try {
        if (existing) {
          const { host } = existing;
          const patch: PluginHostUpdateInput = {
            name: guest.name,
            tags: mergeTags(host.tags, guestTags(guest), [
              MISSING_TAG,
              // The old node's tag, when the guest migrated.
              ...(existing.source.node !== guest.node
                ? [existing.source.node]
                : []),
            ]),
            pluginSettings: {
              [ctx.pluginId]: { [IMPORT_SETTINGS.source]: source },
            },
          };
          // Keep an address set by hand when Proxmox knows none.
          if (guest.ip) patch.ip = guest.ip;
          await ctx.hosts.update(host.id, patch);
          result.updated++;
        } else if (options.create?.has(key) || addNew) {
          const created = await ctx.hosts.create(
            newGuestHost(
              ctx.pluginId,
              guest,
              source,
              node,
              defaults,
              options.create?.get(key),
            ),
          );
          result.hosts[key] = Number(created.id);
          result.created++;
        }
      } catch (err) {
        result.errors.push(
          `${guest.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    for (const [key, { host, source }] of imported) {
      if (seen.has(key)) continue;
      await ctx.hosts.update(host.id, {
        tags: mergeTags(host.tags, [MISSING_TAG]),
        pluginSettings: {
          [ctx.pluginId]: {
            [IMPORT_SETTINGS.source]: {
              ...source,
              missingSince: source.missingSince ?? now,
            },
          },
        },
      });
      result.markedMissing++;
    }

    await ctx.settings.setHost(sourceHostId, IMPORT_SETTINGS.state, {
      lastSyncAt: startedAt,
      status: result.errors.length ? "partial" : "success",
      error: null,
      result,
    });
    return result;
  } catch (err) {
    await ctx.settings
      .setHost(sourceHostId, IMPORT_SETTINGS.state, {
        lastSyncAt: startedAt,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        result,
      })
      .catch(() => {});
    throw err;
  } finally {
    running.delete(sourceHostId);
  }
}

function intervalMinutes(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= MIN_INTERVAL_MINUTES
    ? n
    : DEFAULT_INTERVAL_MINUTES;
}

/** Syncs every node whose owner turned sync on and whose interval has passed. */
export async function runDueSyncs(
  ctx: PluginContext,
  now = Date.now(),
): Promise<void> {
  const nodes = await ctx.settings.listHostValues<boolean>(
    IMPORT_SETTINGS.sync,
  );
  for (const { hostId, userId, value } of nodes) {
    if (value !== true) continue;
    await ctx
      .asUser(userId, async () => {
        if (
          (await ctx.settings.getHost<boolean>(hostId, SETTINGS.enabled)) !==
          true
        )
          return;
        const state =
          (await ctx.settings.getHost<Record<string, unknown>>(
            hostId,
            IMPORT_SETTINGS.state,
          )) ?? {};
        const last =
          typeof state.lastSyncAt === "string"
            ? Date.parse(state.lastSyncAt)
            : 0;
        const interval = intervalMinutes(
          await ctx.settings.getHost(hostId, IMPORT_SETTINGS.interval),
        );
        if (last && now - last < interval * 60_000) return;
        await syncNode(ctx, hostId);
      })
      .catch((err: unknown) =>
        ctx.log.warn(
          `Scheduled guest sync for host ${hostId} failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }
}

export function parseSelection(
  raw: unknown,
): Map<string, GuestChoice> | string {
  const invalid =
    "guests must be a list of { type, vmid, connection?, runtime? }";
  if (!Array.isArray(raw) || raw.length > 1000) return invalid;
  const keys = new Map<string, GuestChoice>();
  for (const entry of raw as Array<Record<string, unknown>>) {
    const vmid = Number(entry?.vmid);
    const connection = entry?.connection ?? undefined;
    const runtime = entry?.runtime ?? null;
    if (
      (entry?.type !== "qemu" && entry?.type !== "lxc") ||
      !Number.isInteger(vmid) ||
      vmid <= 0 ||
      (connection !== undefined &&
        !CONNECTIONS.includes(connection as GuestConnection)) ||
      (runtime !== null && runtime !== "docker" && runtime !== "podman")
    ) {
      return invalid;
    }
    keys.set(guestKey({ type: entry.type, vmid }), {
      connection: connection as GuestConnection | undefined,
      runtime: runtime as ContainerRuntime | null,
    });
  }
  return keys;
}

function failSync(
  ctx: PluginContext,
  res: Parameters<typeof sendError>[1],
  err: unknown,
  what: string,
) {
  const status = (err as { status?: number }).status;
  if (status === 403 || status === 409) {
    return void res.status(status).json({ error: (err as Error).message });
  }
  sendError(ctx, res, err, what);
}

export function registerImport(ctx: PluginContext, router: Router): void {
  /** Checks the node can be imported from by the caller; answers and returns null when not. */
  const nodeFor = async (
    raw: unknown,
    res: Parameters<typeof sendError>[1],
  ) => {
    const hostId = parseHostId(raw);
    if (!hostId) {
      res.status(400).json({ error: "Invalid hostId" });
      return null;
    }
    const access = await ctx.hosts.checkAccess(hostId, "connect");
    if (!access.hasAccess) {
      res.status(404).json({ error: "Host not found" });
      return null;
    }
    if (!access.isOwner) {
      res.status(403).json({
        error: "Only the node's owner can import its guests",
        code: "PVE_HOST_ACCESS",
      });
      return null;
    }
    if (
      (await ctx.settings.getHost<boolean>(hostId, SETTINGS.enabled)) !== true
    ) {
      res.status(409).json({
        error: "Proxmox is not turned on for this host",
        code: "PVE_NOT_ENABLED",
      });
      return null;
    }
    return hostId;
  };

  /**
   * @openapi
   * /plugin-api/pve/hosts/{hostId}/import/links:
   *   get:
   *     summary: Which guests of a node are Termix hosts already
   *     description: The caller's hosts imported from this node, by guest key ("lxc:300"). Reads Termix only, not Proxmox, so it is quick enough to ask on every Console click.
   *     tags: [Proxmox]
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: "Host ids by guest key: { links: { \"lxc:300\": 12 } }." }
   *       400: { description: Invalid hostId. }
   *       404: { description: Host not found. }
   */
  router.get("/hosts/:hostId/import/links", async (req, res) => {
    const hostId = parseHostId((req.params as { hostId?: string }).hostId);
    if (!hostId) return void res.status(400).json({ error: "Invalid hostId" });
    try {
      if (!(await ctx.hosts.checkAccess(hostId, "connect")).hasAccess) {
        return void res.status(404).json({ error: "Host not found" });
      }
      const imported = indexImported(
        await ctx.hosts.listOwned(),
        await ctx.settings.listHostValues(IMPORT_SETTINGS.source),
        hostId,
      );
      res.json({
        links: Object.fromEntries(
          [...imported].map(([key, { host }]) => [key, host.id]),
        ),
      });
    } catch (err) {
      sendError(ctx, res, err, `Import links of host ${hostId}`);
    }
  });

  /**
   * @openapi
   * /plugin-api/pve/hosts/{hostId}/import:
   *   get:
   *     summary: List the guests that can be imported as Termix hosts
   *     description: Every VM and container in the cluster with its address, OS, Docker or Podman inside, whether it is already imported, the saved import defaults and the last sync.
   *     tags: [Proxmox]
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema: { type: integer }
   *       - in: query
   *         name: only
   *         description: One guest key ("lxc:300") to list alone, for importing a single guest.
   *         schema: { type: string }
   *     responses:
   *       200: { description: Guests, defaults and the last sync. }
   *       403: { description: Only the node's owner can import. }
   *       404: { description: Host not found. }
   *       409: { description: Proxmox is not turned on for this host. }
   *       502: { description: The node could not be reached. }
   */
  router.get("/hosts/:hostId/import", async (req, res) => {
    const hostId = await nodeFor(
      (req.params as { hostId?: string }).hostId,
      res,
    );
    if (!hostId) return;
    try {
      const only = (req.query as { only?: unknown }).only;
      const all = await withPveClient(ctx, hostId, discoverGuests);
      const guests =
        typeof only === "string"
          ? all.filter((g) => guestKey(g) === only)
          : all;
      // Only running guests can be asked, and Windows has no sh.
      const runtimes = await probeRuntimes(
        ctx,
        hostId,
        guests.filter(
          (g) => g.status === "running" && g.os.family !== "windows",
        ),
      );
      const owned = await ctx.hosts.listOwned();
      const imported = indexImported(
        owned,
        await ctx.settings.listHostValues(IMPORT_SETTINGS.source),
        hostId,
      );
      const node = owned.find((h) => h.id === hostId);
      res.json({
        guests: guests.map((g) => ({
          ...g,
          runtimes: runtimes.get(g.vmid) ?? null,
          hostId: imported.get(guestKey(g))?.host.id ?? null,
        })),
        defaults: parseDefaults(
          await ctx.settings.getHost(hostId, IMPORT_SETTINGS.defaults),
        ),
        nodeHasCredential:
          node?.authType === "credential" && !!node.credentialId,
        nodeName: node?.name ?? "",
        state:
          (await ctx.settings.getHost(hostId, IMPORT_SETTINGS.state)) ?? null,
      });
    } catch (err) {
      sendError(ctx, res, err, `Guest discovery on host ${hostId}`);
    }
  });

  /**
   * @openapi
   * /plugin-api/pve/hosts/{hostId}/import:
   *   post:
   *     summary: Import guests as Termix hosts
   *     description: Creates a host for each chosen guest, updates the ones imported before and marks those gone from Proxmox. The defaults are saved for later syncs.
   *     tags: [Proxmox]
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema: { type: integer }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [guests]
   *             properties:
   *               guests:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     type: { type: string, enum: [qemu, lxc] }
   *                     vmid: { type: integer }
   *                     connection: { type: string, enum: [ssh, rdp, vnc] }
   *                     runtime:
   *                       type: string
   *                       nullable: true
   *                       enum: [docker, podman]
   *                       description: Turns on the Docker plugin for a new SSH host.
   *               defaults:
   *                 type: object
   *                 properties:
   *                   folder: { type: string }
   *                   ssh:
   *                     type: object
   *                     description: How SSH guests sign in.
   *                     properties:
   *                       mode: { type: string, enum: [node, credential, username, none] }
   *                       credentialId: { type: integer }
   *                       username: { type: string }
   *                   desktop:
   *                     type: object
   *                     description: How RDP and VNC guests sign in.
   *                     properties:
   *                       mode: { type: string, enum: [credential, username, none] }
   *                       credentialId: { type: integer }
   *                       username: { type: string }
   *     responses:
   *       200: { description: How many hosts were created, updated and marked missing. }
   *       400: { description: Invalid body, or a credential that is not the caller's. }
   *       403: { description: Only the node's owner can import. }
   *       409: { description: Proxmox is off for this host, or a sync is running. }
   *       502: { description: The node could not be reached. }
   */
  router.post("/hosts/:hostId/import", async (req, res) => {
    const hostId = await nodeFor(
      (req.params as { hostId?: string }).hostId,
      res,
    );
    if (!hostId) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    // An empty list refreshes the guests imported before.
    const create = parseSelection(body.guests ?? []);
    if (typeof create === "string")
      return void res.status(400).json({ error: create });
    const defaults = parseDefaults(body.defaults);
    try {
      const wanted = defaultsCredentialIds(defaults);
      if (wanted.length) {
        const mine = new Set((await ctx.credentials.list()).map((c) => c.id));
        if (wanted.some((id) => !mine.has(id))) {
          return void res.status(400).json({
            error: "Pick one of your own saved credentials",
            code: "PVE_IMPORT_CREDENTIAL",
          });
        }
      }
      await ctx.settings.setHost(hostId, IMPORT_SETTINGS.defaults, defaults);
      const result = await syncNode(ctx, hostId, { create, defaults });
      await ctx.audit.record({
        action: "pve_import",
        resourceType: "host",
        resourceId: String(hostId),
        details: `created ${result.created}, updated ${result.updated}`,
        success: true,
        request: req,
      });
      res.json(result);
    } catch (err) {
      failSync(ctx, res, err, `Guest import on host ${hostId}`);
    }
  });

  /**
   * @openapi
   * /plugin-api/pve/hosts/{hostId}/import/sync:
   *   post:
   *     summary: Sync the guests imported from a node
   *     description: Updates names, addresses and tags of imported guests and marks the ones gone. New guests are added only when the node is set to add them.
   *     tags: [Proxmox]
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: How many hosts were created, updated and marked missing. }
   *       403: { description: Only the node's owner can import. }
   *       409: { description: Proxmox is off for this host, or a sync is running. }
   *       502: { description: The node could not be reached. }
   */
  router.post("/hosts/:hostId/import/sync", async (req, res) => {
    const hostId = await nodeFor(
      (req.params as { hostId?: string }).hostId,
      res,
    );
    if (!hostId) return;
    try {
      res.json(await syncNode(ctx, hostId));
    } catch (err) {
      failSync(ctx, res, err, `Guest sync on host ${hostId}`);
    }
  });

  ctx.schedule.every(60_000, () => runDueSyncs(ctx), { jitterMs: 30_000 });
}
