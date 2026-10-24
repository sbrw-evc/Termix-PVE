import { describe, expect, it } from "vitest";
import type {
  PluginContext,
  PluginHostRecord,
} from "@termix-ssh/plugin-sdk/backend";
import type { PveClient, PveRequest } from "../../src/backend/pve/client.js";
import {
  MISSING_TAG,
  configIp,
  discoverGuests,
  liveIp,
  mergeTags,
  newGuestHost,
  parseDefaults,
  parseSelection,
  syncNode,
  type DiscoveredGuest,
} from "../../src/backend/import.js";

const node = {
  id: 1,
  name: "Proxmox",
  authType: "credential",
  credentialId: 7,
  jumpHosts: [{ hostId: 9 }],
  tags: null,
} as unknown as PluginHostRecord;

function fakeClient(answers: Record<string, unknown>): PveClient {
  return {
    transport: "pvesh",
    async request<T>(req: PveRequest) {
      const key = req.path.join("/");
      if (!(key in answers)) throw new Error(`no answer for ${key}`);
      return answers[key] as T;
    },
  };
}

describe("guest addresses", () => {
  it("reads static addresses from the config", () => {
    expect(
      configIp({
        net1: "name=eth1,ip=10.0.0.5/24",
        net0: "name=eth0,bridge=vmbr0,ip=192.168.0.50/24,gw=192.168.0.1",
      }),
    ).toBe("192.168.0.50");
    expect(configIp({ net0: "name=eth0,ip=dhcp" })).toBeNull();
    expect(configIp({ ipconfig0: "ip=192.168.0.60/24,gw=192.168.0.1" })).toBe(
      "192.168.0.60",
    );
  });

  it("reads live addresses", () => {
    expect(
      liveIp("lxc", [
        { name: "lo", inet: "127.0.0.1/8" },
        { name: "eth0", inet: "192.168.0.51/24" },
      ]),
    ).toBe("192.168.0.51");
    expect(
      liveIp("qemu", {
        result: [
          {
            name: "ens18",
            "ip-addresses": [
              { "ip-address-type": "ipv6", "ip-address": "fe80::1" },
              { "ip-address-type": "ipv4", "ip-address": "192.168.0.61" },
            ],
          },
        ],
      }),
    ).toBe("192.168.0.61");
    expect(liveIp("qemu", null)).toBeNull();
  });
});

describe("discovery", () => {
  it("lists guests without templates and finds their addresses", async () => {
    const client = fakeClient({
      "cluster/resources": [
        {
          type: "lxc",
          vmid: 400,
          name: "termix",
          node: "pve1",
          status: "running",
        },
        {
          type: "qemu",
          vmid: 300,
          name: "win",
          node: "pve1",
          status: "running",
        },
        { type: "qemu", vmid: 9000, name: "tpl", node: "pve1", template: 1 },
        { type: "node", node: "pve1" },
      ],
      "nodes/pve1/lxc/400/config": {
        net0: "name=eth0,ip=dhcp",
        ostype: "debian",
      },
      "nodes/pve1/lxc/400/interfaces": [
        { name: "eth0", inet: "192.168.0.50/24" },
      ],
      "nodes/pve1/qemu/300/config": { ostype: "win11" },
      // No agent: the address stays unknown.
    });
    const guests = await discoverGuests(client);
    expect(guests).toEqual([
      {
        type: "qemu",
        vmid: 300,
        name: "win",
        node: "pve1",
        status: "running",
        ip: null,
        os: { family: "windows", label: "Windows 11/2022/2025" },
      },
      {
        type: "lxc",
        vmid: 400,
        name: "termix",
        node: "pve1",
        status: "running",
        ip: "192.168.0.50",
        os: { family: "linux", label: "Debian" },
      },
    ]);
  });
});

describe("import", () => {
  const ct: DiscoveredGuest = {
    type: "lxc",
    vmid: 400,
    name: "termix",
    node: "pve1",
    status: "running",
    ip: "192.168.0.50",
    os: { family: "linux", label: "Debian" },
  };
  const source = {
    sourceHostId: 1,
    type: "lxc" as const,
    vmid: 400,
    node: "pve1",
    lastSeenAt: "now",
    lastStatus: "running",
    missingSince: null,
  };

  it("puts guests in an existing nested folder", () => {
    const defaults = parseDefaults({ folder: " SBRW / proxmox/ " });
    expect(defaults.folder).toBe("SBRW/proxmox");
    expect(newGuestHost("pve", ct, source, node, defaults).folder).toBe(
      "SBRW/proxmox",
    );
  });

  it("builds a new host from a guest", () => {
    expect(
      newGuestHost("pve", ct, source, node, parseDefaults({})),
    ).toMatchObject({
      name: "termix",
      ip: "192.168.0.50",
      port: 22,
      username: "",
      authType: "credential",
      credentialId: 7,
      connectionType: "ssh",
      folder: "Proxmox",
      tags: "proxmox,lxc,pve1,ct-400",
      jumpHosts: [{ hostId: 9 }],
      pluginSettings: { pve: { pveSource: source } },
    });
    const plain = newGuestHost(
      "pve",
      ct,
      source,
      node,
      parseDefaults({
        username: "admin",
        useNodeCredential: false,
        folder: "Lab",
      }),
    );
    expect(plain).toMatchObject({
      username: "admin",
      authType: "none",
      credentialId: null,
      folder: "Lab",
    });
    const win = newGuestHost(
      "pve",
      { ...ct, type: "qemu", os: { family: "windows", label: null } },
      source,
      node,
      parseDefaults({}),
    );
    expect(win).toMatchObject({
      connectionType: "rdp",
      port: 3389,
      enableSsh: false,
      credentialId: null,
      protocolAuth: { rdp: { authType: "none" } },
    });
    expect(win.pluginSettings?.["remote-desktop"]).toEqual({
      enableRdp: true,
      rdpPort: 3389,
    });
  });

  it("signs guests in with a saved credential or a username", () => {
    const defaults = parseDefaults({
      ssh: { mode: "credential", credentialId: 12 },
      desktop: { mode: "username", username: " Administrator " },
    });
    expect(newGuestHost("pve", ct, source, node, defaults)).toMatchObject({
      authType: "credential",
      credentialId: 12,
      username: "",
    });
    const vnc = newGuestHost("pve", ct, source, node, defaults, {
      connection: "vnc",
    });
    expect(vnc).toMatchObject({
      connectionType: "vnc",
      port: 5900,
      enableSsh: false,
      protocolAuth: { vnc: { authType: "direct", username: "Administrator" } },
    });
    expect(vnc.pluginSettings?.["remote-desktop"]).toEqual({
      enableVnc: true,
      vncPort: 5900,
    });
    const rdp = newGuestHost(
      "pve",
      ct,
      source,
      node,
      parseDefaults({ desktop: { mode: "credential", credentialId: 3 } }),
      { connection: "rdp" },
    );
    expect(rdp.protocolAuth).toEqual({
      rdp: { authType: "credential", credentialId: 3 },
    });
    // The node signs in with a key of its own: guests get its username.
    const keyNode = { ...node, authType: "key", username: "admin" };
    expect(
      newGuestHost(
        "pve",
        ct,
        source,
        keyNode as PluginHostRecord,
        parseDefaults({}),
      ),
    ).toMatchObject({
      authType: "none",
      username: "admin",
      credentialId: null,
    });
  });

  it("reads old and broken defaults", () => {
    expect(parseDefaults({}).ssh.mode).toBe("node");
    expect(parseDefaults({ useNodeCredential: false }).ssh).toEqual({
      mode: "username",
      credentialId: null,
      username: "root",
    });
    // No credential id, or the node's credential for RDP: fall back.
    expect(parseDefaults({ ssh: { mode: "credential" } }).ssh.mode).toBe(
      "node",
    );
    expect(parseDefaults({ desktop: { mode: "node" } }).desktop.mode).toBe(
      "none",
    );
  });

  it("turns on the Docker plugin for a runtime picked on import", () => {
    const host = newGuestHost("pve", ct, source, node, parseDefaults({}), {
      runtime: "podman",
    });
    expect(host.tags).toBe("proxmox,lxc,pve1,ct-400,podman");
    expect(host.pluginEnable).toEqual({ docker: true });
    expect(host.pluginSettings?.docker).toEqual({ containerRuntime: "podman" });
    // Not for remote desktop hosts.
    const rdp = newGuestHost("pve", ct, source, node, parseDefaults({}), {
      connection: "rdp",
      runtime: "docker",
    });
    expect(rdp.pluginEnable).toBeUndefined();
  });

  it("parses the guests picked in the dialog", () => {
    const picked = parseSelection([
      { type: "lxc", vmid: 400, connection: "ssh", runtime: "docker" },
      { type: "qemu", vmid: 300 },
    ]);
    expect(picked).toEqual(
      new Map([
        ["lxc:400", { connection: "ssh", runtime: "docker" }],
        ["qemu:300", { connection: undefined, runtime: null }],
      ]),
    );
    expect(parseSelection([{ type: "lxc", vmid: 1, connection: "ftp" }])).toBe(
      "guests must be a list of { type, vmid, connection?, runtime? }",
    );
    expect(parseSelection([])).toEqual(new Map());
  });

  it("merges tags", () => {
    expect(
      mergeTags("web, proxmox-missing", ["proxmox", "web"], [MISSING_TAG]),
    ).toBe("web,proxmox");
  });

  it("creates chosen guests, updates imported ones and marks missing ones", async () => {
    const created: unknown[] = [];
    const updates: Array<[number, Record<string, unknown>]> = [];
    const settings = new Map<string, unknown>();
    const imported = {
      ...node,
      id: 2,
      name: "old",
      tags: "proxmox,lxc,pve0,ct-401",
    } as PluginHostRecord;
    const gone = {
      ...node,
      id: 3,
      name: "gone",
      tags: "proxmox",
    } as PluginHostRecord;
    const ctx = {
      pluginId: "pve",
      hosts: {
        listOwned: async () => [node, imported, gone],
        create: async (h: unknown) => {
          created.push(h);
          return { id: 10 };
        },
        update: async (id: number, patch: Record<string, unknown>) =>
          void updates.push([id, patch]),
      },
      settings: {
        getHost: async (_id: number, key: string) => settings.get(key),
        setHost: async (_id: number, key: string, value: unknown) =>
          void settings.set(key, value),
        listHostValues: async () => [
          {
            hostId: 2,
            userId: "u",
            value: { ...source, vmid: 401, node: "pve0" },
          },
          { hostId: 3, userId: "u", value: { ...source, vmid: 402 } },
          // Imported from another node: left alone.
          { hostId: 1, userId: "u", value: { ...source, sourceHostId: 5 } },
        ],
      },
    } as unknown as PluginContext;

    const result = await syncNode(ctx, 1, {
      create: new Map([["lxc:400", {}]]),
      defaults: parseDefaults({}),
      discover: async () => [
        ct,
        { ...ct, vmid: 401, name: "renamed", ip: null },
        { ...ct, vmid: 403 },
      ],
    });
    expect(result).toEqual({
      created: 1,
      updated: 1,
      markedMissing: 1,
      errors: [],
      hosts: { "lxc:400": 10 },
    });
    expect(created).toHaveLength(1);
    expect(updates[0][0]).toBe(2);
    expect(updates[0][1]).toMatchObject({
      name: "renamed",
      tags: "proxmox,lxc,ct-401,pve1",
    });
    expect(updates[0][1].ip).toBeUndefined();
    expect(updates[1][0]).toBe(3);
    expect(updates[1][1].tags).toBe("proxmox,proxmox-missing");
    expect(settings.get("pveImportState")).toMatchObject({ status: "success" });
  });
});
