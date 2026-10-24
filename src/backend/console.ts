/**
 * Guest consoles over the host's SSH connection, so no API ticket is needed
 * and every SSH transport works:
 *
 * - VMs: `qm vncproxy` speaks VNC on stdin/stdout. It refuses to run without
 *   LC_PVE_TICKET, which it sets as the VM's VNC password for 30 seconds, so
 *   each session gets a fresh random one that only its browser learns.
 * - Containers: `pct enter` on a PTY, relayed to xterm.js.
 *
 * Wire format on /plugin-ws/pve/console: the server's first message is a JSON
 * text frame, {t:"ready",kind,password?} or {t:"error",message}. After it a VM
 * relays raw VNC as binary frames both ways. A container sends its output as
 * binary frames and takes JSON text frames: {t:"d",d} for input and
 * {t:"r",c,r} to resize.
 */

import crypto from "node:crypto";
import type { Client, ClientChannel } from "ssh2";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import {
  SETTINGS,
  parseHostConfig,
  resolveTransport,
} from "./pve/connection.js";
import { execCommand } from "./pve/exec.js";

/** The bits of a ws WebSocket this file uses. */
export interface WsLike {
  readyState: number;
  send: (data: string | Buffer, options?: { binary?: boolean }) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: string, listener: (...args: never[]) => void) => void;
}

export interface ConsoleRequest {
  hostId: number;
  node: string;
  type: "qemu" | "lxc";
  vmid: number;
  cols: number;
  rows: number;
}

const OPEN = 1;
// Proxmox node names: letters, digits, dots, dashes and underscores.
const NODE_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Reads and checks the socket's query string. Returns the reason when it is wrong. */
export function parseConsoleQuery(
  url: string | undefined,
): ConsoleRequest | string {
  let params: URLSearchParams;
  try {
    params = new URL(url ?? "", "http://x").searchParams;
  } catch {
    return "Invalid console URL";
  }
  const hostId = Number(params.get("hostId"));
  const vmid = Number(params.get("vmid"));
  const node = params.get("node") ?? "";
  const type = params.get("type");
  const clamp = (
    v: string | null,
    min: number,
    max: number,
    fallback: number,
  ) => {
    // Number(null) is 0, so a missing size must not reach the clamp.
    if (v === null || v.trim() === "") return fallback;
    const n = Number(v);
    return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : fallback;
  };
  if (!Number.isInteger(hostId) || hostId <= 0) return "Invalid hostId";
  if (!Number.isInteger(vmid) || vmid < 100 || vmid > 999999999)
    return "Invalid vmid";
  if (!NODE_RE.test(node)) return "Invalid node";
  if (type !== "qemu" && type !== "lxc") return "Invalid guest type";
  return {
    hostId,
    node,
    type,
    vmid,
    cols: clamp(params.get("cols"), 10, 500, 80),
    rows: clamp(params.get("rows"), 5, 200, 24),
  };
}

const PASSWORD_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** VNC passwords stop at 8 characters, so this is all of it. */
export function vncPassword(): string {
  const bytes = crypto.randomBytes(8);
  return Array.from(
    bytes,
    (b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length],
  ).join("");
}

/**
 * The command for a console. qm and pct need root; other users go through
 * passwordless sudo, and `env` carries the ticket past sudo's cleanup.
 */
export function consoleCommand(
  type: "qemu" | "lxc",
  vmid: number,
  root: boolean,
  password?: string,
): string {
  if (type === "qemu") {
    if (!password || !/^[A-Za-z0-9]{8}$/.test(password))
      throw new Error("Bad VNC password");
    return root
      ? `LC_PVE_TICKET=${password} qm vncproxy ${vmid}`
      : `sudo -n env LC_PVE_TICKET=${password} qm vncproxy ${vmid}`;
  }
  return root ? `pct enter ${vmid}` : `sudo -n pct enter ${vmid}`;
}

function send(ws: WsLike, message: Record<string, unknown>) {
  if (ws.readyState === OPEN) ws.send(JSON.stringify(message));
}

function fail(ws: WsLike, message: string) {
  send(ws, { t: "error", message });
  ws.close(1011, "console failed");
}

function exec(
  client: Client,
  command: string,
  pty: { cols: number; rows: number } | null,
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    const options = pty
      ? { pty: { term: "xterm-256color", cols: pty.cols, rows: pty.rows } }
      : {};
    client.exec(command, options, (err, stream) =>
      err ? reject(err) : resolve(stream),
    );
  });
}

/** Relays one console session until either side closes. */
export async function runConsole(
  ctx: PluginContext,
  ws: WsLike,
  request: ConsoleRequest,
): Promise<void> {
  // Core sets the socket's user as the actor, as it does for routes.
  if (!(await ctx.rbac.has("console"))) {
    return fail(ws, "This needs the pve.console permission");
  }

  const session = await (async () => {
    const access = await ctx.hosts.checkAccess(request.hostId, "edit");
    if (!access.hasAccess)
      return { error: "You need edit access to this host" };
    if (
      (await ctx.settings.getHost(request.hostId, SETTINGS.enabled)) !== true
    ) {
      return { error: "This host is not marked as a Proxmox node" };
    }
    const config = parseHostConfig({
      [SETTINGS.transport]: await ctx.settings.getHost(
        request.hostId,
        SETTINGS.transport,
      ),
    });
    if (resolveTransport(config, true) === "direct") {
      return {
        error:
          "The console runs over SSH, and this host connects to the API directly",
      };
    }
    const connection = await ctx.ssh.connect<Client>(request.hostId, {
      purpose: "proxmox-console",
      profile: "terminal",
    });
    return { connection };
  })();
  if ("error" in session) return fail(ws, session.error ?? "Console failed");

  const { client, dispose } = session.connection;
  let stream: ClientChannel | null = null;
  const close = () => {
    try {
      stream?.close();
    } catch {
      // already closed
    }
    dispose();
  };
  ws.on("close", close);

  try {
    const root =
      (await execCommand(client, "id -u", 10000)).stdout.trim() === "0";
    const password = request.type === "qemu" ? vncPassword() : undefined;
    const command = consoleCommand(request.type, request.vmid, root, password);
    stream = await exec(
      client,
      command,
      request.type === "lxc" ? request : null,
    );
    await ctx.audit.record({
      action: "pve_console",
      resourceType: "host",
      resourceId: String(request.hostId),
      details: `${request.type} ${request.vmid} on ${request.node}`,
      success: true,
    });

    send(ws, {
      t: "ready",
      kind: request.type === "qemu" ? "vnc" : "term",
      password,
    });

    let stderr = "";
    stream.on("data", (data: Buffer) => {
      if (ws.readyState === OPEN) ws.send(data, { binary: true });
    });
    stream.stderr.on("data", (data: Buffer) => {
      // A container's PTY merges stderr; a VM's carries the reason it failed.
      if (request.type === "lxc") {
        if (ws.readyState === OPEN) ws.send(data, { binary: true });
      } else {
        stderr += data.toString("utf8");
      }
    });
    stream.on("close", () => {
      if (stderr.trim())
        send(ws, { t: "error", message: stderr.trim().slice(0, 500) });
      if (ws.readyState === OPEN) ws.close(1000, "console ended");
      dispose();
    });

    ws.on("message", ((data: Buffer, isBinary: boolean) => {
      if (!stream) return;
      if (request.type === "qemu") {
        if (isBinary) stream.write(data);
        return;
      }
      let message: { t?: string; d?: unknown; c?: unknown; r?: unknown };
      try {
        message = JSON.parse(data.toString("utf8"));
      } catch {
        return;
      }
      if (message.t === "d" && typeof message.d === "string") {
        stream.write(message.d);
      } else if (message.t === "r") {
        const cols = Number(message.c);
        const rows = Number(message.r);
        if (
          Number.isInteger(cols) &&
          Number.isInteger(rows) &&
          cols > 0 &&
          rows > 0
        ) {
          stream.setWindow(Math.min(rows, 200), Math.min(cols, 500), 0, 0);
        }
      }
    }) as never);
  } catch (err) {
    close();
    fail(ws, err instanceof Error ? err.message : String(err));
  }
}

export function registerConsole(ctx: PluginContext): void {
  ctx.ws.route("/console", async (conn) => {
    const ws = conn.socket as WsLike;
    if (!conn.isDataUnlocked()) return fail(ws, "Your session is locked");
    const request = parseConsoleQuery((conn.request as { url?: string }).url);
    if (typeof request === "string") return fail(ws, request);
    try {
      await runConsole(ctx, ws, request);
    } catch (err) {
      fail(ws, err instanceof Error ? err.message : String(err));
    }
  });
}
