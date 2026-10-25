/**
 * ISO images and CT templates uploaded from the browser. The body streams
 * straight into the storage's directory on the node over SSH: Proxmox's own
 * upload API wants multipart through ctx.fetch, which only sends strings, and
 * pvesh has no upload at all. File based storages (dir, NFS, CIFS) only.
 *
 * Big files come in chunks. Node's HTTP server (and proxies in front of
 * Termix) cut a request off after about five minutes, and the browser then
 * sends the whole file again from the start, forever. Each chunk is written
 * at its offset with dd, so a chunk sent twice lands in the same place.
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
const ID_RE = /^[a-z0-9]{8,32}$/;
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
  /** Where this chunk goes in the file. 0 for a whole-file upload. */
  offset: number;
  /** The file's full size; null for a whole-file upload in one request. */
  total: number | null;
  /** Names the temporary file, so two tabs uploading apart don't mix. */
  id: string | null;
}

const wholeNumber = (value: unknown) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : NaN;
};

export function parseUploadQuery(
  hostIdRaw: unknown,
  query: Record<string, unknown>,
): UploadRequest | string {
  const hostId = parseHostId(hostIdRaw);
  const node = String(query.node ?? "");
  const storage = String(query.storage ?? "");
  const content = String(query.content ?? "");
  const filename = String(query.filename ?? "");
  const offset = wholeNumber(query.offset) ?? 0;
  const total = wholeNumber(query.total);
  const id = query.upload === undefined ? null : String(query.upload);
  if (!hostId) return "Invalid hostId";
  if (!NODE_RE.test(node)) return "Invalid node";
  if (!STORAGE_RE.test(storage)) return "Invalid storage";
  if (content !== "iso" && content !== "vztmpl")
    return "content must be iso or vztmpl";
  if (!FILE_RE.test(filename) || filename.includes(".."))
    return "Invalid file name";
  if (!EXTENSIONS[content].test(filename))
    return "Wrong file type for this content";
  if (Number.isNaN(offset) || Number.isNaN(total))
    return "offset and total must be whole numbers";
  if (total !== null && (total === 0 || offset >= total))
    return "offset must be inside the file";
  if (total === null && offset !== 0) return "A chunk needs the file's total";
  if (id !== null && !ID_RE.test(id)) return "Invalid upload id";
  return { hostId, node, storage, content, filename, offset, total, id };
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

/** The file chunks are collected in until the last one arrives. */
export function tempPath(path: string, id: string | null): string {
  return id ? `${path}.termix-upload-${id}` : `${path}.termix-upload`;
}

function sudo(root: boolean, command: string) {
  return root ? command : `sudo -n ${command}`;
}

/** The command that writes a chunk at its place in the file. */
export function writeCommand(root: boolean, tmp: string, offset: number) {
  // seek_bytes: seek counts bytes, not blocks; notrunc: keep what follows.
  return sudo(
    root,
    `dd of=${shellQuote(tmp)} bs=1M oflag=seek_bytes seek=${offset} conv=notrunc status=none`,
  );
}

function openWrite(client: Client, command: string): Promise<ClientChannel> {
  return new Promise((resolve, reject) =>
    client.exec(command, {}, (err, stream) =>
      err ? reject(err) : resolve(stream),
    ),
  );
}

class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Streams the request body into the file at the offset; returns how many bytes came. */
function streamBody(req: Request, sink: ClientChannel): Promise<number> {
  let size = 0;
  let aborted = false;
  let exitCode: number | null = null;
  let stderr = "";
  req.on("aborted", () => {
    aborted = true;
    sink.close();
  });
  // The channel only closes once its output is read, so read it even
  // though dd writes nothing: an unread stream never ends.
  sink.resume();
  sink.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  sink.on("exit", (code: number | null) => {
    exitCode = code;
  });
  return new Promise<number>((resolve, reject) => {
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
        : resolve(size),
    );
  });
}

async function upload(
  ctx: PluginContext,
  req: Request,
  res: Response,
  request: UploadRequest,
) {
  const whole = request.total === null;
  await ctx.ssh.withConnection<void, Client>(
    request.hostId,
    { pool: "pve-upload", purpose: "proxmox-upload" },
    async (client) => {
      const run = (command: string, timeoutMs = 20000) =>
        execCommand(client, command, timeoutMs);
      const root = (await run("id -u", 10000)).stdout.trim() === "0";
      const volume = `${request.storage}:${request.content}/${request.filename}`;
      const located = await run(sudo(root, `pvesm path ${shellQuote(volume)}`));
      const path = located.stdout.trim();
      if (located.code !== 0 || !checkVolumePath(path, request.filename)) {
        throw new UploadError(
          located.stderr.trim() ||
            "This storage keeps no files Termix can write to",
          400,
          "PVE_UPLOAD_STORAGE",
        );
      }
      const tmp = tempPath(path, request.id);
      const sizeOf = async (file: string) => {
        const stat = await run(sudo(root, `stat -c %s ${shellQuote(file)}`));
        return stat.code === 0 ? Number(stat.stdout.trim()) : null;
      };

      if (request.offset === 0) {
        if ((await run(`test -e ${shellQuote(path)}`, 10000)).code === 0) {
          throw new UploadError(
            `${request.filename} is already there`,
            409,
            "PVE_UPLOAD_EXISTS",
          );
        }
        const dir = path.slice(0, path.lastIndexOf("/"));
        await run(sudo(root, `mkdir -p ${shellQuote(dir)}`));
        // A fresh start: drop what an earlier try left.
        await run(sudo(root, `truncate -s 0 ${shellQuote(tmp)}`));
      } else {
        const have = await sizeOf(tmp);
        if (have === null || have < request.offset) {
          // Out of step (a lost chunk, or the file is gone): say how much is
          // there, so the browser carries on from that point.
          throw new UploadError(
            "The node has less of this file than this chunk follows",
            409,
            "PVE_UPLOAD_OFFSET",
            { received: have ?? 0 },
          );
        }
      }

      let size: number;
      try {
        const sink = await openWrite(
          client,
          writeCommand(root, tmp, request.offset),
        );
        size = await streamBody(req, sink);
      } catch (err) {
        // A whole-file upload can't be resumed; chunks keep what arrived.
        if (whole)
          await run(sudo(root, `rm -f ${shellQuote(tmp)}`)).catch(() => {});
        throw err;
      }

      const end = request.offset + size;
      if (!whole && end < request.total!) {
        res.json({ received: end, done: false });
        return;
      }
      const total = whole ? end : request.total!;
      // A chunk sent twice can leave nothing extra, but be exact anyway.
      await run(sudo(root, `truncate -s ${total} ${shellQuote(tmp)}`));
      if ((await sizeOf(tmp)) !== total) {
        throw new UploadError(
          "The file on the node is not the size it should be",
          502,
          "PVE_UPLOAD_FAILED",
        );
      }
      const moved = await run(
        sudo(root, `mv -n ${shellQuote(tmp)} ${shellQuote(path)}`),
        60000,
      );
      if (moved.code !== 0 || (await sizeOf(tmp)) !== null) {
        throw new UploadError(
          moved.stderr.trim() || "Could not move the upload into place",
          502,
          "PVE_UPLOAD_FAILED",
        );
      }
      await ctx.audit.record({
        action: "pve_upload",
        resourceType: "host",
        resourceId: String(request.hostId),
        details: `${volume} (${total} bytes)`,
        success: true,
        request: req,
      });
      res.json({ volid: volume, size: total, received: total, done: true });
    },
  );
}

/** Removes what a cancelled or abandoned chunked upload left on the node. */
async function cancel(ctx: PluginContext, request: UploadRequest) {
  await ctx.ssh.withConnection<void, Client>(
    request.hostId,
    { pool: "pve-upload", purpose: "proxmox-upload" },
    async (client) => {
      const root =
        (await execCommand(client, "id -u", 10000)).stdout.trim() === "0";
      const volume = `${request.storage}:${request.content}/${request.filename}`;
      const located = await execCommand(
        client,
        sudo(root, `pvesm path ${shellQuote(volume)}`),
        20000,
      );
      const path = located.stdout.trim();
      if (located.code !== 0 || !checkVolumePath(path, request.filename))
        return;
      await execCommand(
        client,
        sudo(root, `rm -f ${shellQuote(tempPath(path, request.id))}`),
        15000,
      );
    },
  );
}

/** The checks both routes share. Answers and returns null when one fails. */
async function admit(
  ctx: PluginContext,
  req: Request,
  res: Response,
): Promise<UploadRequest | null> {
  const request = parseUploadQuery(
    (req.params as { hostId?: string }).hostId,
    req.query as Record<string, unknown>,
  );
  if (typeof request === "string") {
    res.status(400).json({ error: request });
    return null;
  }
  if (!(await ctx.rbac.has("configure"))) {
    res.status(403).json({
      error: "This needs the pve.configure permission",
      code: "PVE_PERMISSION",
    });
    return null;
  }
  if (!(await ctx.hosts.checkAccess(request.hostId, "edit")).hasAccess) {
    res.status(404).json({ error: "Host not found" });
    return null;
  }
  if ((await ctx.settings.getHost(request.hostId, SETTINGS.enabled)) !== true) {
    res.status(409).json({
      error: "This host is not marked as a Proxmox node",
      code: "PVE_NOT_ENABLED",
    });
    return null;
  }
  const config = parseHostConfig({
    [SETTINGS.transport]: await ctx.settings.getHost(
      request.hostId,
      SETTINGS.transport,
    ),
  });
  if (resolveTransport(config, true) === "direct") {
    res.status(400).json({
      error: "Uploads go over SSH, and this host connects to the API directly",
      code: "PVE_UPLOAD_NEEDS_SSH",
    });
    return null;
  }
  return request;
}

export function registerUpload(ctx: PluginContext, router: Router): void {
  /**
   * @openapi
   * /plugin-api/pve/hosts/{hostId}/upload:
   *   post:
   *     summary: Upload an ISO image or CT template to a node's storage
   *     description: >
   *       The request body is the file, or one chunk of it, sent as
   *       application/octet-stream. It streams over SSH into the storage's
   *       directory and is renamed into place once complete. With total, the
   *       body is the chunk starting at offset; the last chunk completes the
   *       file. Needs pve.configure and edit access to the host.
   *     tags: [Proxmox]
   *     parameters:
   *       - { in: path, name: hostId, required: true, schema: { type: integer } }
   *       - { in: query, name: node, required: true, schema: { type: string } }
   *       - { in: query, name: storage, required: true, schema: { type: string } }
   *       - { in: query, name: content, required: true, schema: { type: string, enum: [iso, vztmpl] } }
   *       - { in: query, name: filename, required: true, schema: { type: string } }
   *       - { in: query, name: offset, schema: { type: integer }, description: Where this chunk starts. }
   *       - { in: query, name: total, schema: { type: integer }, description: The whole file's size, for chunks. }
   *       - { in: query, name: upload, schema: { type: string }, description: An id for this upload's chunks. }
   *     requestBody:
   *       required: true
   *       content:
   *         application/octet-stream: {}
   *     responses:
   *       200: { description: "How much the node has; with done, the new volume id and its size." }
   *       400: { description: Invalid query, or the storage keeps no files. }
   *       403: { description: Missing pve.configure, or edit access to the host. }
   *       404: { description: Host not found. }
   *       409: { description: "The file is already there, the chunk is out of step (received says how much the node has), or Proxmox is off for this host." }
   *       502: { description: The upload did not finish. }
   *   delete:
   *     summary: Drop an unfinished chunked upload
   *     description: Removes the temporary file of an upload that was cancelled or given up.
   *     tags: [Proxmox]
   *     parameters:
   *       - { in: path, name: hostId, required: true, schema: { type: integer } }
   *       - { in: query, name: node, required: true, schema: { type: string } }
   *       - { in: query, name: storage, required: true, schema: { type: string } }
   *       - { in: query, name: content, required: true, schema: { type: string, enum: [iso, vztmpl] } }
   *       - { in: query, name: filename, required: true, schema: { type: string } }
   *       - { in: query, name: upload, schema: { type: string } }
   *     responses:
   *       204: { description: Removed, or nothing was there. }
   *       400: { description: Invalid query. }
   *       403: { description: Missing pve.configure, or edit access to the host. }
   *       404: { description: Host not found. }
   */
  router.post("/hosts/:hostId/upload", async (req, res) => {
    const request = await admit(ctx, req, res);
    if (!request) return;
    try {
      await upload(ctx, req, res, request);
    } catch (err) {
      if (res.headersSent) return;
      if (err instanceof UploadError) {
        res
          .status(err.status)
          .json({ error: err.message, code: err.code, ...err.extra });
        return;
      }
      res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
        code: "PVE_UPLOAD_FAILED",
      });
    }
  });

  router.delete("/hosts/:hostId/upload", async (req, res) => {
    const request = await admit(ctx, req, res);
    if (!request) return;
    try {
      await cancel(ctx, request);
      res.status(204).end();
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : String(err),
        code: "PVE_UPLOAD_FAILED",
      });
    }
  });
}
