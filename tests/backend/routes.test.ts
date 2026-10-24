import { afterEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { createMockCtx } from "@termix-ssh/plugin-sdk/testing";
import type { PluginHostSummary } from "@termix-ssh/plugin-sdk/backend";
import { activate } from "../../src/backend/index.js";

/** An ssh2 client that answers like a root shell on a Proxmox node. */
function fakeNode(answers: Record<string, string>) {
  const commands: string[] = [];
  const client = {
    exec(
      command: string,
      _opts: unknown,
      cb: (err: Error | null, stream: unknown) => void,
    ) {
      commands.push(command);
      const stream = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        destroy() {},
      });
      cb(null, stream);
      setImmediate(() => {
        if (command === "id -u") stream.emit("data", Buffer.from("0\n"));
        const match = Object.keys(answers).find((key) => command.includes(key));
        if (match) stream.emit("data", Buffer.from(answers[match]));
        stream.emit("close", match || command === "id -u" ? 0 : 1);
      });
    },
  };
  return { client, commands };
}

const host = {
  id: 1,
  name: "Proxmox",
  ip: "192.168.0.200",
  userId: "user-1",
} as unknown as PluginHostSummary;

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

async function start(options: { permissions: string[]; enabled?: boolean }) {
  const node = fakeNode({
    "'/cluster/resources'": JSON.stringify([
      { id: "node/pve1", type: "node", node: "pve1" },
    ]),
    "'/nodes/pve1/lxc/400/status/start'": JSON.stringify(
      "UPID:pve1:00001234:0000ABCD:65A1B2C3:vzstart:400:root@pam:",
    ),
  });
  const router = express.Router();
  const mock = createMockCtx({
    pluginId: "pve",
    actor: "user-1",
    permissions: options.permissions,
    hosts: [host],
    sshHosts: [host as never],
    sshClient: node.client,
    router: () => router,
    capabilities: [
      "hosts:read",
      "credentials:use",
      "credentials:read",
      "ssh:connect",
      "network:serve",
      "network:outbound",
      "ui:surface",
    ],
  });
  const ctx = mock.ctx;
  if (options.enabled !== false)
    await ctx.settings.setHost(1, "enablePve", true);
  await activate(ctx);
  const app = express();
  app.use(express.json());
  app.use(router);
  server = app.listen(0);
  const { port } = server.address() as AddressInfo;
  const call = (body: unknown) =>
    fetch(`http://127.0.0.1:${port}/hosts/1/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return { mock, node, call };
}

describe("POST /hosts/:hostId/call", () => {
  it("reads the cluster with the view permission", async () => {
    const { call, node } = await start({ permissions: ["pve.view"] });
    const res = await call({ path: ["cluster", "resources"] });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([
      { id: "node/pve1", type: "node", node: "pve1" },
    ]);
    expect(node.commands).toContain(
      "pvesh get '/cluster/resources' --output-format json",
    );
  });

  it("refuses the whole router without the view permission", async () => {
    const { call } = await start({ permissions: [] });
    expect((await call({ path: ["cluster", "resources"] })).status).toBe(403);
  });

  it("refuses power without the operate permission", async () => {
    const { call, node } = await start({ permissions: ["pve.view"] });
    const res = await call({
      method: "POST",
      path: ["nodes", "pve1", "lxc", "400", "status", "start"],
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: "PVE_PERMISSION",
      permission: "operate",
    });
    expect(node.commands).toEqual([]);
  });

  it("starts a guest with operate and audits it", async () => {
    const { call, mock } = await start({
      permissions: ["pve.view", "pve.operate"],
    });
    const res = await call({
      method: "POST",
      path: ["nodes", "pve1", "lxc", "400", "status", "start"],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatch(/^UPID:pve1:/);
    expect(mock.audits).toContainEqual(
      expect.objectContaining({
        action: "pve_call",
        details: "POST /nodes/pve1/lxc/400/status/start",
        success: true,
      }),
    );
  });

  it("refuses paths no rule lists, whatever the permissions", async () => {
    const { call, node } = await start({
      permissions: [
        "pve.view",
        "pve.operate",
        "pve.configure",
        "pve.administer",
      ],
    });
    const res = await call({
      method: "POST",
      path: ["nodes", "pve1", "execute"],
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "PVE_PATH_NOT_ALLOWED" });
    expect(node.commands).toEqual([]);
  });

  it("refuses a host that is not a Proxmox node", async () => {
    const { call } = await start({ permissions: ["pve.view"], enabled: false });
    const res = await call({ path: ["cluster", "resources"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "PVE_NOT_ENABLED" });
  });

  it("answers 400 for a body it can't use", async () => {
    const { call } = await start({ permissions: ["pve.view"] });
    expect((await call({ method: "PATCH", path: ["version"] })).status).toBe(
      400,
    );
  });
});
