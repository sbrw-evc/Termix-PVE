/**
 * ISO images and CT templates uploaded from the browser. The body streams
 * straight into the storage's directory on the node over SSH: Proxmox's own
 * upload API wants multipart through ctx.fetch, which only sends strings, and
 * pvesh has no upload at all. File based storages (dir, NFS, CIFS) only.
 */

import type { Request, Response, Router } from "express";
import type { Client, ClientChannel } from "ssh2";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import {
  SETTINGS,
  parseHostConfig,
  resolveTransport,
} from "./pve/connection.js";
import { execCommand } from "./pve/exec.js";
import { shellQuote } from "./pve/client.js";
import { parseHostId } from "./routes.js";

const NODE_RE = /^[A-Za-z0-9._-]{1,64}$/;
const STORAGE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,200}$/;
const EXTENSIONS = {
  iso: /\.(iso|img)$/i,
  vztmpl: /\.(tar\.(gz|xz|zst)|tgz)$/i,
};

export interface UploadRequest {
  hostId: number;
  node: string;
  storage: string;
  content: "iso" | "vztmpl";
  filename: string;
}

export function parseUploadQuery(
  hostIdRaw: unknown,
  query: Record<string, unknown>,
): UploadRequest | string {
  const hostId = parseHostId(hostIdRaw);
  const node = String(query.node ?? "");
  const storage = String(query.storage ?? "");
  const content = String(query.content ?? "");
  const filename = String(query.filename ?? "");
  if (!hostId) return "Invalid hostId";
  if (!NODE_RE.test(node)) return "Invalid node";
  if (!STORAGE_RE.test(storage)) return "Invalid storage";
  if (content !== "iso" && content !== "vztmpl")
    return "content must be iso or vztmpl";
  if (!FILE_RE.test(filename) || filename.includes(".."))
    return "Invalid file name";
  if (!EXTENSIONS[content].test(filename))
    return "Wrong file type for this content";
  return { hostId, node, storage, content, filename };
}

/** Where pvesm keeps the volume, if it is a plain file under an absolute path. */
export function checkVolumePath(path: string, filename: string): boolean {
  return (
    path.startsWith("/") &&
    !path.includes("\n") &&
    !path.split("/").includes("..") &&
    path.endsWith(`/${filename}`)
  );
}

function sudo(root: boolean, command: string) {
  return root ? command : `sudo -n ${command}`;
}

function openWrite(client: Client, command: string): Promise<ClientChannel> {
  return new Promise((resolve, reject) =>
    client.exec(command, {}, (err, stream) =>
      err ? reject(err) : resolve(stream),
    ),
  );
}

async function upload(
  ctx: PluginContext,
  req: Request,
  res: Response,
  request: UploadRequest,
) {
  const { client, dispose } = await ctx.ssh.connect<Client>(request.hostId, {
    purpose: "proxmox-upload",
    profile: "stream",
  });
  let tmp: string | null = null;
  let root = false;
  const cleanup = async () => {
    if (tmp)
      await execCommand(
        client,
        sudo(root, `rm -f ${shellQuote(tmp)}`),
        15000,
      ).catch(() => {});
  };
  try {
    root = (await execCommand(client, "id -u", 10000)).stdout.trim() === "0";
    const volume = `${request.storage}:${request.content}/${request.filename}`;
    const located = await execCommand(
      client,
      sudo(root, `pvesm path ${shellQuote(volume)}`),
      20000,
    );
    const path = located.stdout.trim();
    if (located.code !== 0 || !checkVolumePath(path, request.filename)) {
      return void res.status(400).json({
        error:
          located.stderr.trim() ||
          "This storage keeps no files Termix can write to",
        code: "PVE_UPLOAD_STORAGE",
      });
    }
    const exists = await execCommand(
      client,
      `test -e ${shellQuote(path)}`,
      10000,
    );
    if (exists.code === 0) {
      return void res.status(409).json({
        error: `${request.filename} is already there`,
        code: "PVE_UPLOAD_EXISTS",
      });
    }

    tmp = `${path}.termix-upload`;
    const dir = path.slice(0, path.lastIndexOf("/"));
    await execCommand(client, sudo(root, `mkdir -p ${shellQuote(dir)}`), 15000);
    const sink = await openWrite(
      client,
      sudo(root, `tee ${shellQuote(tmp)}`) + " >/dev/null",
    );

    let size = 0;
    let aborted = false;
    let exitCode: number | null = null;
    let stderr = "";
    req.on("aborted", () => {
      aborted = true;
      sink.close();
    });
    // The channel only closes once its output is read, so read it even
    // though tee writes nothing: an unread stream never ends.
    sink.resume();
    sink.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    sink.on("exit", (code: number | null) => {
      exitCode = code;
    });
    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (!sink.write(chunk)) {
          req.pause();
          sink.once("drain", () => req.resume());
        }
      });
      req.on("end", () => sink.end());
      req.on("error", reject);
      sink.on("close", () =>
        aborted || exitCode !== 0
          ? reject(new Error(stderr.trim() || "The upload did not finish"))
          : resolve(),
      );
    });

    const moved = await execCommand(
      client,
      sudo(root, `mv -n ${shellQuote(tmp)} ${shellQuote(path)}`),
      60000,
    );
    if (moved.code !== 0)
      throw new Error(
        moved.stderr.trim() || "Could not move the upload into place",
      );
    tmp = null;
    await ctx.audit.record({
      action: "pve_upload",
      resourceType: "host",
      resourceId: String(request.hostId),
      details: `${volume} (${size} bytes)`,
      success: true,
      request: req,
    });
    res.json({ volid: volume, size });
  } catch (err) {
    await cleanup();
    if (!res.headersSent) {
      res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
        code: "PVE_UPLOAD_FAILED",
      });
    }
  } finally {
    dispose();
  }
}

export function registerUpload(ctx: PluginContext, router: Router): void {
  /**
   * @openapi
   * /plugin-api/pve/hosts/{hostId}/upload:
   *   post:
   *     summary: Upload an ISO image or CT template to a node's storage
   *     description: >
   *       The request body is the file, sent as application/octet-stream. It
   *       streams over SSH into the storage's directory and is renamed into
   *       place once complete. Needs pve.configure and edit access to the host.
   *     tags: [Proxmox]
   *     parameters:
   *       - { in: path, name: hostId, required: true, schema: { type: integer } }
   *       - { in: query, name: node, required: true, schema: { type: string } }
   *       - { in: query, name: storage, required: true, schema: { type: string } }
   *       - { in: query, name: content, required: true, schema: { type: string, enum: [iso, vztmpl] } }
   *       - { in: query, name: filename, required: true, schema: { type: string } }
   *     requestBody:
   *       required: true
   *       content:
   *         application/octet-stream: {}
   *     responses:
   *       200: { description: The new volume id and its size. }
   *       400: { description: Invalid query, or the storage keeps no files. }
   *       403: { description: Missing pve.configure, or edit access to the host. }
   *       404: { description: Host not found. }
   *       409: { description: The file is already there, or Proxmox is off for this host. }
   *       502: { description: The upload did not finish. }
   */
  router.post("/hosts/:hostId/upload", async (req, res) => {
    const request = parseUploadQuery(
      (req.params as { hostId?: string }).hostId,
      req.query as Record<string, unknown>,
    );
    if (typeof request === "string")
      return void res.status(400).json({ error: request });
    if (!(await ctx.rbac.has("configure"))) {
      return void res.status(403).json({
        error: "This needs the pve.configure permission",
        code: "PVE_PERMISSION",
      });
    }
    if (!(await ctx.hosts.checkAccess(request.hostId, "edit")).hasAccess) {
      return void res.status(404).json({ error: "Host not found" });
    }
    if (
      (await ctx.settings.getHost(request.hostId, SETTINGS.enabled)) !== true
    ) {
      return void res.status(409).json({
        error: "This host is not marked as a Proxmox node",
        code: "PVE_NOT_ENABLED",
      });
    }
    const config = parseHostConfig({
      [SETTINGS.transport]: await ctx.settings.getHost(
        request.hostId,
        SETTINGS.transport,
      ),
    });
    if (resolveTransport(config, true) === "direct") {
      return void res.status(400).json({
        error:
          "Uploads go over SSH, and this host connects to the API directly",
        code: "PVE_UPLOAD_NEEDS_SSH",
      });
    }
    try {
      await upload(ctx, req, res, request);
    } catch (err) {
      if (!res.headersSent) {
        res.status(502).json({
          error: err instanceof Error ? err.message : String(err),
          code: "PVE_UPLOAD_FAILED",
        });
      }
    }
  });
}
