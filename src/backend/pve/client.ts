/**
 * One client for the Proxmox VE API over three transports.
 *
 * Paths and parameters are the same everywhere: the REST API under
 * /api2/json and pvesh both take /nodes/{node}/qemu/{vmid}/... with the same
 * arguments, so code above this file is written once against API paths.
 *
 * - tunnel: HTTPS to 127.0.0.1:8006 on the node through an SSH channel, with
 *   an API token. The SSH host key already proves which machine we reach, so
 *   the node's self-signed certificate is not checked inside the tunnel.
 * - direct: HTTPS straight to the API through ctx.fetch, with an API token
 *   and the node's CA.
 * - pvesh: pvesh over SSH, as root or through sudo. No token needed.
 */

import http from "node:http";
import tls from "node:tls";
import zlib from "node:zlib";
import type { Duplex } from "node:stream";
import type { Client } from "ssh2";
import type { PluginFetch } from "@termix-ssh/plugin-sdk/backend";
import type { PveshRunner } from "./pvesh-runner.js";

export type PveTransport = "tunnel" | "direct" | "pvesh";
export type PveMethod = "GET" | "POST" | "PUT" | "DELETE";
export type PveParamValue = string | number | boolean | null | undefined;
export type PveParams = Record<string, PveParamValue>;

export interface PveRequest {
  method?: PveMethod;
  /** Path segments under /api2/json, like ["nodes", "pve1", "qemu", 100]. */
  path: Array<string | number>;
  params?: PveParams;
  timeoutMs?: number;
}

export interface PveClient {
  readonly transport: PveTransport;
  request<T = unknown>(request: PveRequest): Promise<T>;
}

export type PveErrorCode =
  | "PVE_API_ERROR"
  | "PVE_AUTH_FAILED"
  | "PVE_NOT_FOUND"
  | "PVE_BAD_OUTPUT"
  | "PVE_UNREACHABLE"
  | "PVE_TLS_UNTRUSTED"
  | "PVE_TLS_HOSTNAME"
  | "PVE_TLS_EXPIRED"
  | "PVE_BAD_REQUEST";

/** A failed Proxmox call, with the HTTP status PVE gave and its field errors. */
export class PveError extends Error {
  constructor(
    message: string,
    readonly code: PveErrorCode,
    readonly status = 502,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "PveError";
  }
}

export const DEFAULT_PVE_PORT = 8006;
const DEFAULT_TIMEOUT_MS = 30000;

// Node names, vmids, storage ids, UPIDs, snapshot names, users and token ids.
const SAFE_SEGMENT_RE = /^[A-Za-z0-9._@!:=+-]{1,256}$/;
// A volume id is one segment that may hold slashes: local:iso/debian.iso.
const SAFE_VOLUME_RE = /^[A-Za-z0-9._@!:=+-]+(\/[A-Za-z0-9._@!:=+-]+)*$/;

function isSafeSegment(value: string): boolean {
  if (value.length > 512) return false;
  if (SAFE_SEGMENT_RE.test(value)) return value !== "." && value !== "..";
  return (
    value.includes(":") &&
    SAFE_VOLUME_RE.test(value) &&
    !value.split(/[/:]/).some((part) => part === "." || part === "..")
  );
}
const SAFE_PARAM_KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}(\[\d+\])?$/;

/**
 * Checks every path segment so a request can never leave the path it names.
 * The API takes each segment URL-encoded; pvesh takes them as they are,
 * so a volume id's slash stays a slash there.
 */
export function pvePath(
  segments: Array<string | number>,
  encode = false,
): string {
  if (!segments.length) {
    throw new PveError("Empty API path", "PVE_BAD_REQUEST", 400);
  }
  return (
    "/" +
    segments
      .map((segment) => {
        const value = String(segment);
        if (!isSafeSegment(value)) {
          throw new PveError(
            `Invalid API path segment: ${value}`,
            "PVE_BAD_REQUEST",
            400,
          );
        }
        return encode ? encodeURIComponent(value) : value;
      })
      .join("/")
  );
}

/** Parameters with null and undefined dropped and booleans as 1 and 0, as PVE takes them. */
export function pveParamEntries(
  params: PveParams = {},
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    if (!SAFE_PARAM_KEY_RE.test(key)) {
      throw new PveError(
        `Invalid API parameter: ${key}`,
        "PVE_BAD_REQUEST",
        400,
      );
    }
    entries.push([
      key,
      typeof value === "boolean" ? (value ? "1" : "0") : String(value),
    ]);
  }
  return entries;
}

export interface PveApiToken {
  /** user@realm!tokenname */
  tokenId: string;
  secret: string;
}

const TOKEN_ID_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+![A-Za-z][A-Za-z0-9._-]*$/;

export function isValidTokenId(tokenId: string): boolean {
  return TOKEN_ID_RE.test(tokenId);
}

function authHeader(token: PveApiToken): string {
  return `PVEAPIToken=${token.tokenId}=${token.secret}`;
}

function errorFromStatus(
  status: number,
  reason: string,
  body: unknown,
): PveError {
  const fieldErrors =
    body && typeof body === "object" && "errors" in body
      ? Object.fromEntries(
          Object.entries(
            ((body as { errors?: unknown }).errors ?? {}) as Record<
              string,
              unknown
            >,
          ).map(([key, value]) => [key, String(value)]),
        )
      : {};
  const message = reason || `Proxmox answered ${status}`;
  if (status === 401) {
    return new PveError(message, "PVE_AUTH_FAILED", 401, fieldErrors);
  }
  if (status === 403) {
    return new PveError(message, "PVE_AUTH_FAILED", 403, fieldErrors);
  }
  if (status === 404 || status === 501) {
    return new PveError(message, "PVE_NOT_FOUND", 404, fieldErrors);
  }
  if (status === 400) {
    return new PveError(message, "PVE_BAD_REQUEST", 400, fieldErrors);
  }
  return new PveError(message, "PVE_API_ERROR", 502, fieldErrors);
}

/** Unwraps PVE's { data } envelope, or turns a failed answer into a PveError. */
export function parseApiResponse<T>(
  status: number,
  reason: string,
  text: string,
): T {
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (status >= 200 && status < 300) {
        throw new PveError(
          "Proxmox returned output that could not be read",
          "PVE_BAD_OUTPUT",
        );
      }
    }
  }
  if (status < 200 || status >= 300) {
    throw errorFromStatus(status, reason, body);
  }
  return (
    body && typeof body === "object" && "data" in body
      ? (body as { data: unknown }).data
      : null
  ) as T;
}

function buildTarget(request: PveRequest): {
  method: PveMethod;
  pathAndQuery: string;
  body: string | undefined;
} {
  const method = request.method ?? "GET";
  const path = `/api2/json${pvePath(request.path, true)}`;
  const params = new URLSearchParams(pveParamEntries(request.params));
  const encoded = params.toString();
  if (method === "GET" || method === "DELETE") {
    return {
      method,
      pathAndQuery: encoded ? `${path}?${encoded}` : path,
      body: undefined,
    };
  }
  return { method, pathAndQuery: path, body: encoded };
}

// tunnel

/**
 * The body as text, unpacked when PVE compressed it. It gzips some answers,
 * like /nodes/{node}/journal, even when the request did not ask for it.
 */
export function decodeBody(body: Buffer, encoding: string | undefined): string {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return zlib.gunzipSync(body).toString("utf8");
    case "deflate":
      return zlib.inflateSync(body).toString("utf8");
    case "br":
      return zlib.brotliDecompressSync(body).toString("utf8");
    default:
      return body.toString("utf8");
  }
}

/** Opens a raw stream to the API port on the node. */
export type StreamOpener = () => Promise<Duplex>;

/** A stream to 127.0.0.1:<port> on the far side of an ssh2 connection. */
export function sshForwardOpener(
  client: Client,
  port = DEFAULT_PVE_PORT,
): StreamOpener {
  return () =>
    new Promise((resolve, reject) => {
      client.forwardOut("127.0.0.1", 0, "127.0.0.1", port, (err, stream) => {
        if (err) {
          reject(
            new PveError(
              `Could not reach the Proxmox API on port ${port} of the node: ${err.message}`,
              "PVE_UNREACHABLE",
            ),
          );
        } else {
          resolve(stream);
        }
      });
    });
}

export function createTunnelClient(
  openStream: StreamOpener,
  token: PveApiToken,
): PveClient {
  return {
    transport: "tunnel",
    request<T>(request: PveRequest): Promise<T> {
      const target = buildTarget(request);
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      return new Promise<T>((resolve, reject) => {
        const req = http.request(
          {
            method: target.method,
            path: target.pathAndQuery,
            host: "127.0.0.1",
            // No agent: with agent false Node makes a fresh Agent, which
            // dials host:port itself and never calls createConnection.
            headers: {
              Host: "127.0.0.1",
              Authorization: authHeader(token),
              Accept: "application/json",
              ...(target.body !== undefined
                ? {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Content-Length": Buffer.byteLength(target.body),
                  }
                : {}),
            },
            createConnection: (_options, callback) => {
              openStream().then(
                (stream) => {
                  const socket = tls.connect({
                    socket: stream,
                    servername: "localhost",
                    // Inside the SSH channel; see the file comment.
                    rejectUnauthorized: false,
                  });
                  callback(null, socket);
                },
                (err: Error) => callback(err, undefined as never),
              );
              return undefined;
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              try {
                resolve(
                  parseApiResponse<T>(
                    res.statusCode ?? 0,
                    res.statusMessage ?? "",
                    decodeBody(
                      Buffer.concat(chunks),
                      res.headers["content-encoding"],
                    ),
                  ),
                );
              } catch (err) {
                reject(err);
              }
            });
            res.on("error", reject);
          },
        );
        req.setTimeout(timeoutMs, () => {
          req.destroy(
            new PveError(
              `Proxmox did not answer within ${timeoutMs}ms`,
              "PVE_UNREACHABLE",
              504,
            ),
          );
        });
        req.on("error", (err) =>
          reject(
            err instanceof PveError
              ? err
              : new PveError(err.message, "PVE_UNREACHABLE"),
          ),
        );
        if (target.body !== undefined) req.write(target.body);
        req.end();
      });
    },
  };
}

// direct

export interface DirectApiOptions {
  host: string;
  port?: number;
  token: PveApiToken;
  /** PEM of the node's CA, /etc/pve/pve-root-ca.pem by default on PVE. */
  caCert?: string | null;
}

const HOSTNAME_RE = /^[A-Za-z0-9.-]{1,253}$|^\[[0-9A-Fa-f:.]+\]$/;

// Node's TLS error codes, grouped by what the user has to change.
const TLS_UNTRUSTED = new Set([
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED",
  "CERT_SIGNATURE_FAILURE",
]);
const TLS_HOSTNAME = new Set([
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
]);
const TLS_EXPIRED = new Set(["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID"]);

/**
 * fetch only says "fetch failed"; the reason, like a TLS error code or
 * ECONNREFUSED, sits further down the cause chain.
 */
function fetchCause(err: unknown): { code?: string; message?: string } {
  let current: unknown = err;
  let deepest: { code?: string; message?: string } = {};
  for (let depth = 0; current && depth < 6; depth++) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown };
    deepest = {
      code: typeof e.code === "string" ? e.code : deepest.code,
      message: typeof e.message === "string" ? e.message : deepest.message,
    };
    current = e.cause;
  }
  return deepest;
}

export function fetchFailure(
  origin: string,
  err: unknown,
  hasCa: boolean,
): PveError {
  const cause = fetchCause(err);
  const code = cause.code ?? "";
  if (TLS_UNTRUSTED.has(code)) {
    return new PveError(
      hasCa
        ? `The certificate of ${origin} is not signed by the CA saved for this host (${code}). Paste the node's /etc/pve/pve-root-ca.pem again.`
        : `The certificate of ${origin} is not trusted (${code}). Paste the node's CA from /etc/pve/pve-root-ca.pem into CA certificate, or connect through the API over SSH tunnel.`,
      "PVE_TLS_UNTRUSTED",
    );
  }
  if (TLS_HOSTNAME.has(code)) {
    return new PveError(
      `The certificate of ${origin} is for another name (${code}). Set API address to a name or address the certificate lists.`,
      "PVE_TLS_HOSTNAME",
    );
  }
  if (TLS_EXPIRED.has(code)) {
    return new PveError(
      `The certificate of ${origin} has expired or is not valid yet (${code}).`,
      "PVE_TLS_EXPIRED",
    );
  }
  const reason =
    cause.message && cause.message !== (err as Error)?.message
      ? `${(err as Error).message} (${cause.message})`
      : ((err as Error)?.message ?? String(err));
  return new PveError(
    `Could not reach the Proxmox API at ${origin}: ${reason}`,
    "PVE_UNREACHABLE",
  );
}

export function createDirectClient(
  fetchFn: PluginFetch,
  options: DirectApiOptions,
): PveClient {
  if (!HOSTNAME_RE.test(options.host)) {
    throw new PveError("Invalid API host", "PVE_BAD_REQUEST", 400);
  }
  const port = options.port ?? DEFAULT_PVE_PORT;
  const origin = `https://${options.host}:${port}`;
  const bareHost = options.host.replace(/^\[|\]$/g, "");
  return {
    transport: "direct",
    async request<T>(request: PveRequest): Promise<T> {
      const target = buildTarget(request);
      let response: Response;
      try {
        response = await fetchFn(`${origin}${target.pathAndQuery}`, {
          method: target.method,
          headers: {
            Authorization: authHeader(options.token),
            Accept: "application/json",
            ...(target.body !== undefined
              ? { "Content-Type": "application/x-www-form-urlencoded" }
              : {}),
          },
          body: target.body,
          timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          // The user named this host for their own node, which is usually on
          // a private network.
          allowPrivateHosts: [bareHost],
          ...(options.caCert ? { tls: { ca: options.caCert } } : {}),
        });
      } catch (err) {
        throw fetchFailure(origin, err, !!options.caCert);
      }
      return parseApiResponse<T>(
        response.status,
        response.statusText,
        await response.text(),
      );
    },
  };
}

// pvesh

const PVESH_VERBS: Record<PveMethod, string> = {
  GET: "get",
  POST: "create",
  PUT: "set",
  DELETE: "delete",
};

/** Quotes one word for a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildPveshCommand(request: PveRequest): string {
  const method = request.method ?? "GET";
  const parts = [
    "pvesh",
    PVESH_VERBS[method],
    shellQuote(pvePath(request.path)),
  ];
  for (const [key, value] of pveParamEntries(request.params)) {
    parts.push(`--${key}`, shellQuote(value));
  }
  parts.push("--output-format", "json");
  return parts.join(" ");
}

/** pvesh prints "<status> <reason>" or just the reason on failure. */
function pveshError(stderr: string, code: number | null): PveError {
  const text = stderr.trim() || `pvesh exited with code ${code}`;
  const lines = text.split("\n").map((line) => line.trim());
  const fieldErrors: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Za-z][\w-]*):\s+(.+)$/);
    if (m && !/^(error|warning)$/i.test(m[1])) fieldErrors[m[1]] = m[2];
  }
  const head = lines[0] ?? text;
  const status = head.match(/^(\d{3})\s/);
  if (status) {
    return errorFromStatus(
      Number(status[1]),
      head.slice(4).trim(),
      Object.keys(fieldErrors).length ? { errors: fieldErrors } : null,
    );
  }
  if (/no such|does not exist|not found/i.test(text)) {
    return new PveError(head, "PVE_NOT_FOUND", 404, fieldErrors);
  }
  if (/parameter verification failed/i.test(text)) {
    return new PveError(head, "PVE_BAD_REQUEST", 400, fieldErrors);
  }
  return new PveError(head, "PVE_API_ERROR", 502, fieldErrors);
}

export function createPveshClient(run: PveshRunner): PveClient {
  return {
    transport: "pvesh",
    async request<T>(request: PveRequest): Promise<T> {
      const result = await run(
        buildPveshCommand(request),
        request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      if (result.code !== 0) throw pveshError(result.stderr, result.code);
      const out = result.stdout.trim();
      if (!out) return null as T;
      try {
        return JSON.parse(out) as T;
      } catch {
        // Calls that start a task print the bare UPID.
        if (/^UPID:/.test(out)) return out as T;
        throw new PveError(
          "pvesh returned output that could not be read",
          "PVE_BAD_OUTPUT",
        );
      }
    },
  };
}
