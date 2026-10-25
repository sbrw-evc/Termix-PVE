import express, { type Response, type Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { PveError, type PveMethod, type PveParams } from "./pve/client.js";
import { SETTINGS, parseHostConfig, withPveClient } from "./pve/connection.js";
import { findRule, hostLevelFor, paramsAllowed } from "./pve/policy.js";

const METHODS: PveMethod[] = ["GET", "POST", "PUT", "DELETE"];
const MAX_PATH_SEGMENTS = 12;

export function parseHostId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Turns a failed call into an answer the UI can show, without failing the plugin. */
export function sendError(
  ctx: PluginContext,
  res: Response,
  err: unknown,
  what: string,
): void {
  if (err instanceof PveError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      fieldErrors: err.fieldErrors,
    });
    return;
  }
  // SSH failures land here: unreachable host, auth, host key.
  const message = err instanceof Error ? err.message : String(err);
  ctx.log.warn(`${what} failed: ${message}`);
  res.status(502).json({ error: message, code: "PVE_UNREACHABLE" });
}

interface CallBody {
  method: PveMethod;
  path: string[];
  params: PveParams;
}

/** Checks the shape of a /call body. Returns the reason when it is wrong. */
export function parseCallBody(body: unknown): CallBody | string {
  const raw = (body ?? {}) as Record<string, unknown>;
  const method = String(raw.method ?? "GET").toUpperCase() as PveMethod;
  if (!METHODS.includes(method)) return "Unknown method";
  if (
    !Array.isArray(raw.path) ||
    raw.path.length === 0 ||
    raw.path.length > MAX_PATH_SEGMENTS ||
    !raw.path.every(
      (segment) =>
        (typeof segment === "string" && segment.length > 0) ||
        typeof segment === "number",
    )
  ) {
    return "path must be a list of segments";
  }
  const params = raw.params ?? {};
  if (typeof params !== "object" || Array.isArray(params)) {
    return "params must be an object";
  }
  for (const value of Object.values(params as Record<string, unknown>)) {
    const scalar = (v: unknown) =>
      v === null ||
      v === undefined ||
      ["string", "number", "boolean"].includes(typeof v);
    const ok = Array.isArray(value)
      ? value.every((v) => typeof v === "string")
      : scalar(value);
    if (!ok) {
      return "params values must be strings, numbers, booleans or lists of strings";
    }
  }
  return {
    method,
    path: raw.path.map(String),
    params: params as PveParams,
  };
}

async function isEnabled(ctx: PluginContext, hostId: number) {
  return (
    (await ctx.settings.getHost<boolean>(hostId, SETTINGS.enabled)) === true
  );
}

export function registerRoutes(ctx: PluginContext, router: Router): void {
  const hosts = express.Router({ mergeParams: true });
  router.use(ctx.rbac.require("view") as never);

  /**
   * @openapi
   * /plugin-api/pve/hosts/{hostId}/connection:
   *   get:
   *     summary: Test the connection to a Proxmox node
   *     description: Calls the node with the transport the host is set to and returns the PVE version.
   *     tags: [Proxmox]
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema: { type: integer }
   *     responses:
   *       200: { description: The transport used and the PVE version. }
   *       400: { description: Invalid hostId, or the API token is missing. }
   *       401: { description: Proxmox refused the API token. }
   *       403: { description: Missing the pve.view permission. }
   *       404: { description: Host not found. }
   *       409: { description: Proxmox is not turned on for this host. }
   *       502: { description: The node could not be reached. }
   */
  hosts.get("/connection", async (req, res) => {
    const hostId = parseHostId((req.params as { hostId?: string }).hostId);
    if (!hostId) return void res.status(400).json({ error: "Invalid hostId" });
    if (!(await ctx.hosts.checkAccess(hostId, "connect")).hasAccess) {
      return void res.status(404).json({ error: "Host not found" });
    }
    if (!(await isEnabled(ctx, hostId))) {
      return void res.status(409).json({
        error: "Proxmox is not turned on for this host",
        code: "PVE_NOT_ENABLED",
      });
    }
    try {
      const result = await withPveClient(ctx, hostId, async (client) => ({
        transport: client.transport,
        configuredTransport: parseHostConfig({
          [SETTINGS.transport]: await ctx.settings.getHost(
            hostId,
            SETTINGS.transport,
          ),
        }).transport,
        version: await client.request({ path: ["version"] }),
      }));
      res.json(result);
    } catch (err) {
      sendError(ctx, res, err, `Proxmox connection test for host ${hostId}`);
    }
  });

  /**
   * @openapi
   * /plugin-api/pve/hosts/{hostId}/call:
   *   post:
   *     summary: Call the Proxmox API of a node
   *     description: >
   *       Runs one Proxmox API call on the node through the host's transport.
   *       Only the paths this plugin lists are allowed, each with the
   *       permission it needs: pve.view to read, pve.operate for power,
   *       pve.configure to change guests and pve.administer for access and the
   *       cluster. Changes need edit access to the host and are audited.
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
   *             required: [path]
   *             properties:
   *               method: { type: string, enum: [GET, POST, PUT, DELETE] }
   *               path:
   *                 type: array
   *                 items: { type: string }
   *                 example: [nodes, pve1, qemu, "100", status, start]
   *               params: { type: object }
   *     responses:
   *       200: { description: "The call's data: a list, an object or a task id." }
   *       400: { description: Invalid body, or Proxmox refused the parameters. }
   *       403: { description: The path is not allowed, or the permission it needs is missing. }
   *       404: { description: Host not found. }
   *       409: { description: Proxmox is not turned on for this host. }
   *       502: { description: The node could not be reached. }
   */
  hosts.post("/call", async (req, res) => {
    const hostId = parseHostId((req.params as { hostId?: string }).hostId);
    if (!hostId) return void res.status(400).json({ error: "Invalid hostId" });
    const body = parseCallBody(req.body);
    if (typeof body === "string")
      return void res.status(400).json({ error: body });

    const rule = findRule(body.method, body.path);
    if (!rule) {
      return void res.status(403).json({
        error: `${body.method} /${body.path.join("/")} is not allowed`,
        code: "PVE_PATH_NOT_ALLOWED",
      });
    }
    if (!paramsAllowed(rule, body.params)) {
      return void res.status(403).json({
        error: `These parameters are not allowed for ${body.method} /${body.path.join("/")}`,
        code: "PVE_PARAMS_NOT_ALLOWED",
      });
    }
    if (!(await ctx.rbac.has(rule.permission))) {
      return void res.status(403).json({
        error: `This needs the pve.${rule.permission} permission`,
        code: "PVE_PERMISSION",
        permission: rule.permission,
      });
    }
    const access = await ctx.hosts.checkAccess(
      hostId,
      hostLevelFor(rule.permission),
    );
    if (!access.hasAccess) {
      const visible = (await ctx.hosts.checkAccess(hostId, "connect"))
        .hasAccess;
      return void res.status(visible ? 403 : 404).json({
        error: visible
          ? "You need edit access to this host to change it"
          : "Host not found",
        code: visible ? "PVE_HOST_ACCESS" : undefined,
      });
    }
    if (!(await isEnabled(ctx, hostId))) {
      return void res.status(409).json({
        error: "Proxmox is not turned on for this host",
        code: "PVE_NOT_ENABLED",
      });
    }

    const changes = body.method !== "GET";
    const target = `${body.method} /${body.path.join("/")}`;
    try {
      const data = await withPveClient(ctx, hostId, (client) =>
        client.request({
          method: body.method,
          path: body.path,
          params: body.params,
          timeoutMs: changes ? 120000 : undefined,
        }),
      );
      if (changes) {
        await ctx.audit.record({
          action: "pve_call",
          resourceType: "host",
          resourceId: String(hostId),
          details: target,
          success: true,
          request: req,
        });
      }
      res.json({ data });
    } catch (err) {
      if (changes) {
        await ctx.audit
          .record({
            action: "pve_call",
            resourceType: "host",
            resourceId: String(hostId),
            details: target,
            success: false,
            errorMessage: err instanceof Error ? err.message : String(err),
            request: req,
          })
          .catch(() => {});
      }
      sendError(ctx, res, err, `Proxmox ${target} on host ${hostId}`);
    }
  });

  router.use("/hosts/:hostId", hosts);
}
