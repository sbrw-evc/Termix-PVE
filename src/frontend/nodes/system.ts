import type { PveParams } from "../api";

// DNS

/** GET /nodes/{node}/dns. */
export interface NodeDns {
  search?: string;
  dns1?: string;
  dns2?: string;
  dns3?: string;
}

export interface DnsForm {
  search: string;
  servers: [string, string, string];
}

export function dnsForm(dns: NodeDns | null): DnsForm {
  return {
    search: dns?.search ?? "",
    servers: [dns?.dns1 ?? "", dns?.dns2 ?? "", dns?.dns3 ?? ""],
  };
}

const IP4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const IP6 = /^[0-9a-fA-F:]+(%\w+)?$/;
const DOMAIN =
  /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

/** A locale key for what is wrong, or null. PVE needs a search domain. */
export function dnsProblem(f: DnsForm): string | null {
  if (!DOMAIN.test(f.search.trim())) return "search";
  for (const server of f.servers) {
    const s = server.trim();
    if (s && !IP4.test(s) && !(s.includes(":") && IP6.test(s))) return "server";
  }
  if (!f.servers.some((s) => s.trim())) return "noServer";
  return null;
}

/**
 * PVE rewrites resolv.conf from what it is sent, so empty servers are left
 * out and the ones given move up: "", "1.1.1.1" becomes dns1=1.1.1.1.
 */
export function dnsParams(f: DnsForm): PveParams {
  const servers = f.servers.map((s) => s.trim()).filter(Boolean);
  return {
    search: f.search.trim(),
    dns1: servers[0],
    dns2: servers[1],
    dns3: servers[2],
  };
}

// Time

/** GET /nodes/{node}/time: seconds since the epoch, local time as if it were UTC. */
export interface NodeTime {
  timezone: string;
  time: number;
  localtime: number;
}

/** The node's wall clock, read as UTC because PVE already shifted it. */
export function nodeClock(time: NodeTime): string {
  return new Date(time.localtime * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
}

/** Every IANA zone the browser knows, the node's own first if it is missing. */
export function timeZones(current: string): string[] {
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  const zones = intl.supportedValuesOf?.("timeZone") ?? [];
  const all = new Set(["UTC", ...zones]);
  if (current) all.add(current);
  return [...all].sort();
}

// Certificates

/** One entry of GET /nodes/{node}/certificates/info. */
export interface NodeCertificate {
  filename: string;
  subject?: string;
  issuer?: string;
  fingerprint?: string;
  notbefore?: number;
  notafter?: number;
  san?: string[];
  "public-key-type"?: string;
  "public-key-bits"?: number;
}

/** "/OU=x/CN=name" → "name"; the whole subject when it has no CN. */
export function commonName(dn: string | undefined): string {
  if (!dn) return "";
  const cn = dn.match(/(?:^|\/)CN=([^/]+)/);
  return cn ? cn[1] : dn;
}

export type CertState = "valid" | "expiring" | "expired" | "notYet";

/** Expiring is less than 30 days left, as Proxmox warns. */
export function certState(
  cert: NodeCertificate,
  now = Date.now() / 1000,
): CertState {
  if (cert.notbefore && now < cert.notbefore) return "notYet";
  if (cert.notafter && now > cert.notafter) return "expired";
  if (cert.notafter && cert.notafter - now < 30 * 86400) return "expiring";
  return "valid";
}

// Repositories

/** GET /nodes/{node}/apt/repositories, the parts the UI uses. */
export interface AptRepositories {
  digest: string;
  files: Array<{
    path: string;
    "file-type"?: string;
    repositories: Array<{
      Types?: string[];
      URIs?: string[];
      Suites?: string[];
      Components?: string[];
      Enabled: number | boolean;
      Comment?: string;
    }>;
  }>;
  errors?: Array<{ path: string; error: string }>;
  infos?: Array<{
    path: string;
    index: number;
    kind: string;
    message: string;
    property?: string;
  }>;
  "standard-repos"?: Array<{
    handle: string;
    name: string;
    description?: string;
    status?: number | null;
  }>;
}

export interface RepoRow {
  path: string;
  index: number;
  enabled: boolean;
  /** "deb https://… trixie pve-no-subscription" */
  line: string;
  /** Proxmox, Debian, …, from the infos PVE adds. */
  origin: string | null;
  warnings: string[];
}

/** One row per repository, with the origin and warnings PVE reports for it. */
export function repoRows(data: AptRepositories | null): RepoRow[] {
  if (!data) return [];
  const rows: RepoRow[] = [];
  for (const file of data.files ?? []) {
    file.repositories.forEach((repo, index) => {
      const infos = (data.infos ?? []).filter(
        (i) => i.path === file.path && i.index === index,
      );
      rows.push({
        path: file.path,
        index,
        enabled: repo.Enabled === true || repo.Enabled === 1,
        line: [
          (repo.Types ?? []).join(" "),
          (repo.URIs ?? []).join(" "),
          (repo.Suites ?? []).join(" "),
          (repo.Components ?? []).join(" "),
        ]
          .filter(Boolean)
          .join(" "),
        origin: infos.find((i) => i.kind === "origin")?.message ?? null,
        warnings: infos
          .filter(
            (i) =>
              i.kind === "warning" || i.kind === "ignore-pre-upgrade-warning",
          )
          .map((i) => i.message),
      });
    });
  }
  return rows;
}

/** Standard Proxmox repositories not configured yet (status null), to add. */
export function addableRepos(data: AptRepositories | null) {
  return (data?.["standard-repos"] ?? []).filter(
    (r) => r.status === null || r.status === undefined,
  );
}

// Task history

/** One entry of GET /nodes/{node}/tasks. */
export interface NodeTask {
  upid: string;
  node: string;
  type: string;
  id?: string;
  user: string;
  status?: string;
  starttime: number;
  endtime?: number;
}

export interface TaskFilter {
  errorsOnly: boolean;
  type: string;
  vmid: string;
  user: string;
}

export const TASK_PAGE = 50;

export function taskParams(f: TaskFilter, start: number): PveParams {
  const vmid = Number(f.vmid);
  return {
    start,
    limit: TASK_PAGE,
    errors: f.errorsOnly || undefined,
    typefilter: f.type.trim() || undefined,
    vmid: Number.isInteger(vmid) && vmid >= 100 ? vmid : undefined,
    userfilter: f.user.trim() || undefined,
  };
}

/** Running, OK, or the error text PVE stores as the status. */
export function taskState(task: NodeTask): "running" | "ok" | "error" {
  if (!task.endtime && !task.status) return "running";
  return task.status === "OK" ? "ok" : "error";
}

// Disks: LVM, LVM-Thin, ZFS

/** A volume group of GET /nodes/{node}/disks/lvm, with its physical volumes. */
export interface LvmNode {
  name: string;
  size?: number;
  free?: number;
  lvcount?: number;
  leaf?: number;
  children?: LvmNode[];
}

export function volumeGroups(data: unknown): LvmNode[] {
  const root = data as { children?: LvmNode[] } | null;
  return root?.children ?? [];
}
