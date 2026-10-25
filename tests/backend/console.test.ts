import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createMockCtx } from "@termix-ssh/plugin-sdk/testing";
import type { PluginHostSummary } from "@termix-ssh/plugin-sdk/backend";
import {
  consoleCommand,
  parseConsoleQuery,
  runConsole,
  vncPassword,
  type WsLike,
} from "../../src/backend/console.js";

describe("parseConsoleQuery", () => {
  it("reads a console request", () => {
    expect(
      parseConsoleQuery(
        "/plugin-ws/pve/console?hostId=1&node=pve1&type=lxc&vmid=400&cols=120&rows=40",
      ),
    ).toEqual({
      hostId: 1,
      node: "pve1",
      type: "lxc",
      vmid: 400,
      cols: 120,
      rows: 40,
    });
    expect(
      parseConsoleQuery("/c?hostId=1&node=pve1&type=qemu&vmid=100&cols=x"),
    ).toMatchObject({
      cols: 80,
      rows: 24,
    });
  });

  it("refuses anything it can't put in a command", () => {
    expect(
      parseConsoleQuery("/c?hostId=1&node=pve1;rm&type=lxc&vmid=400"),
    ).toBe("Invalid node");
    expect(parseConsoleQuery("/c?hostId=1&node=pve1&type=lxc&vmid=4;id")).toBe(
      "Invalid vmid",
    );
    expect(parseConsoleQuery("/c?hostId=1&node=pve1&type=node&vmid=400")).toBe(
      "Invalid guest type",
    );
    expect(parseConsoleQuery("/c?hostId=0&node=pve1&type=lxc&vmid=400")).toBe(
      "Invalid hostId",
    );
  });
});

describe("consoleCommand", () => {
  it("runs qm vncproxy with a one-time ticket, through sudo for non-root", () => {
    expect(consoleCommand("qemu", 100, true, "Ab3dEf7h")).toBe(
      "LC_PVE_TICKET=Ab3dEf7h qm vncproxy 100",
    );
    expect(consoleCommand("qemu", 100, false, "Ab3dEf7h")).toBe(
      "sudo -n env LC_PVE_TICKET=Ab3dEf7h qm vncproxy 100",
    );
    expect(() => consoleCommand("qemu", 100, true, "x'; id")).toThrow();
  });

  it("enters a container", () => {
    expect(consoleCommand("lxc", 400, true)).toBe("pct enter 400");
    expect(consoleCommand("lxc", 400, false)).toBe("sudo -n pct enter 400");
  });

  it("makes 8 character passwords that differ", () => {
    const a = vncPassword();
    expect(a).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(
      new Set(Array.from({ length: 20 }, vncPassword)).size,
    ).toBeGreaterThan(15);
  });
});

/** A ws WebSocket stand-in that records what it was sent. */
function fakeWs() {
  const ws = Object.assign(new EventEmitter(), {
    readyState: 1,
    sent: [] as Array<string | Buffer>,
    closed: null as null | number,
    send(data: string | Buffer) {
      this.sent.push(data);
    },
    close(code?: number) {
      this.closed = code ?? 1000;
      this.readyState = 3;
    },
  });
  return ws as typeof ws & WsLike;
}

/** An ssh2 client whose exec returns a channel the test drives. */
function fakeSsh() {
  const channel = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    written: [] as unknown[],
    window: null as null | number[],
    write(d: unknown) {
      this.written.push(d);
    },
    setWindow(...args: number[]) {
      this.window = args;
    },
    close: vi.fn(),
    destroy() {},
  });
  const commands: Array<{ command: string; options: unknown }> = [];
  const client = {
    exec(
      command: string,
      options: unknown,
      cb: (err: Error | null, s: unknown) => void,
    ) {
      commands.push({ command, options });
      if (command === "id -u") {
        const s = Object.assign(new EventEmitter(), {
          stderr: new EventEmitter(),
          destroy() {},
        });
        cb(null, s);
        setImmediate(() => {
          s.emit("data", Buffer.from("0\n"));
          s.emit("close", 0);
        });
        return;
      }
      cb(null, channel);
    },
  };
  return { client, channel, commands };
}

const host = {
  id: 1,
  name: "pve",
  ip: "10.0.0.2",
  userId: "u1",
} as unknown as PluginHostSummary;

async function setup(permissions: string[], transport = "auto") {
  const ssh = fakeSsh();
  const mock = createMockCtx({
    pluginId: "pve",
    actor: "u1",
    permissions,
    hosts: [host],
    sshHosts: [host as never],
    sshClient: ssh.client,
    capabilities: [
      "hosts:read",
      "credentials:use",
      "credentials:read",
      "ssh:connect",
      "network:serve",
    ],
  });
  await mock.ctx.settings.setHost(1, "enablePve", true);
  await mock.ctx.settings.setHost(1, "pveTransport", transport);
  return { ctx: mock.ctx, mock, ssh };
}

const request = (type: "qemu" | "lxc") => ({
  hostId: 1,
  node: "pve1",
  type,
  vmid: type === "qemu" ? 100 : 400,
  cols: 100,
  rows: 30,
});

describe("runConsole", () => {
  it("refuses without the console permission", async () => {
    const { ctx, ssh } = await setup(["pve.view"]);
    const ws = fakeWs();
    await runConsole(ctx, ws, request("lxc"));
    expect(JSON.parse(String(ws.sent[0]))).toMatchObject({ t: "error" });
    expect(ws.closed).toBe(1011);
    expect(ssh.commands).toEqual([]);
  });

  it("refuses a host that connects to the API directly", async () => {
    const { ctx } = await setup(["pve.view", "pve.console"], "direct");
    const ws = fakeWs();
    await runConsole(ctx, ws, request("lxc"));
    expect(JSON.parse(String(ws.sent[0])).message).toMatch(/SSH/);
  });

  it("relays a container shell with input and resizes", async () => {
    const { ctx, ssh, mock } = await setup(["pve.view", "pve.console"]);
    const ws = fakeWs();
    await runConsole(ctx, ws, request("lxc"));
    expect(ssh.commands[1]).toEqual({
      command: "pct enter 400",
      options: { pty: { term: "xterm-256color", cols: 100, rows: 30 } },
    });
    expect(JSON.parse(String(ws.sent[0]))).toEqual({
      t: "ready",
      kind: "term",
    });

    ssh.channel.emit("data", Buffer.from("root@ct:~# "));
    expect(ws.sent[1]).toEqual(Buffer.from("root@ct:~# "));
    ws.emit(
      "message",
      Buffer.from(JSON.stringify({ t: "d", d: "ls\r" })),
      false,
    );
    ws.emit(
      "message",
      Buffer.from(JSON.stringify({ t: "r", c: 132, r: 43 })),
      false,
    );
    expect(ssh.channel.written).toEqual(["ls\r"]);
    expect(ssh.channel.window).toEqual([43, 132, 0, 0]);
    expect(mock.audits).toContainEqual(
      expect.objectContaining({ action: "pve_console", success: true }),
    );

    ssh.channel.emit("close");
    expect(ws.closed).toBe(1000);
  });

  it("relays a VM's VNC with a fresh password", async () => {
    const { ctx, ssh } = await setup(["pve.view", "pve.console"]);
    const ws = fakeWs();
    await runConsole(ctx, ws, request("qemu"));
    const ready = JSON.parse(String(ws.sent[0]));
    expect(ready).toMatchObject({ t: "ready", kind: "vnc" });
    expect(ssh.commands[1].command).toBe(
      `LC_PVE_TICKET=${ready.password} qm vncproxy 100`,
    );
    expect(ssh.commands[1].options).toEqual({});

    ws.emit("message", Buffer.from([1, 2, 3]), true);
    ws.emit("message", Buffer.from("text is ignored"), false);
    expect(ssh.channel.written).toEqual([Buffer.from([1, 2, 3])]);

    ssh.channel.stderr.emit("data", Buffer.from("VM 100 not running\n"));
    ssh.channel.emit("close");
    expect(JSON.parse(String(ws.sent.at(-1)))).toEqual({
      t: "error",
      message: "VM 100 not running",
    });
  });
});

describe("Ceph install session", () => {
  it("takes a known version and repository only", () => {
    expect(
      parseConsoleQuery(
        "/c?hostId=1&node=pve1&type=ceph-install&version=squid&repository=no-subscription&cols=100&rows=30",
      ),
    ).toMatchObject({
      type: "ceph-install",
      vmid: 0,
      cephVersion: "squid",
      cephRepository: "no-subscription",
      cols: 100,
      rows: 30,
    });
    expect(
      parseConsoleQuery(
        "/c?hostId=1&node=pve1&type=ceph-install&version=$(reboot)&repository=test",
      ),
    ).toBe("Invalid Ceph version");
    expect(
      parseConsoleQuery(
        "/c?hostId=1&node=pve1&type=ceph-install&version=squid&repository=manual",
      ),
    ).toBe("Invalid Ceph repository");
  });

  it("runs pveceph install, through sudo for other users", () => {
    const options = { version: "tentacle", repository: "no-subscription" };
    expect(consoleCommand("ceph-install", 0, true, undefined, options)).toBe(
      "pveceph install --version tentacle --repository no-subscription",
    );
    expect(consoleCommand("ceph-install", 0, false, undefined, options)).toBe(
      "sudo -n pveceph install --version tentacle --repository no-subscription",
    );
    expect(() =>
      consoleCommand("ceph-install", 0, true, undefined, {
        version: "x; rm -rf /",
        repository: "test",
      }),
    ).toThrow();
  });
});
