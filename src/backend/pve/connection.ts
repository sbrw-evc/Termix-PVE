import type { Client } from "ssh2";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { createPveshRunner } from "./pvesh-runner.js";
import {
  DEFAULT_PVE_PORT,
  PveError,
  createDirectClient,
  createPveshClient,
  createTunnelClient,
  isValidTokenId,
  sshForwardOpener,
  type PveApiToken,
  type PveClient,
  type PveTransport,
} from "./client.js";

export type PveTransportSetting = "auto" | PveTransport;

/** Host setting keys, declared in manifest.json under contributes.settings.host. */
export const SETTINGS = {
  enabled: "enablePve",
  transport: "pveTransport",
  tokenId: "pveTokenId",
  tokenSecret: "pveTokenSecret",
  apiHost: "pveApiHost",
  apiPort: "pveApiPort",
  caCert: "pveCaCert",
} as const;

export interface PveHostConfig {
  transport: PveTransportSetting;
  tokenId: string | null;
  /** Direct only: the address of the API, the host's own address when empty. */
  apiHost: string | null;
  apiPort: number;
  /** Direct only: PEM of the node's CA. */
  caCert: string | null;
}

const TRANSPORTS: PveTransportSetting[] = ["auto", "tunnel", "direct", "pvesh"];

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export function parseHostConfig(raw: Record<string, unknown>): PveHostConfig {
  const port = Number(raw[SETTINGS.apiPort]);
  const transport = raw[SETTINGS.transport] as PveTransportSetting;
  return {
    transport: TRANSPORTS.includes(transport) ? transport : "auto",
    tokenId: text(raw[SETTINGS.tokenId]),
    apiHost: text(raw[SETTINGS.apiHost]),
    apiPort:
      Number.isInteger(port) && port > 0 && port < 65536
        ? port
        : DEFAULT_PVE_PORT,
    caCert: text(raw[SETTINGS.caCert]),
  };
}

/** Which transport a host ends up on: auto picks the tunnel once a token is saved. */
export function resolveTransport(
  config: PveHostConfig,
  hasToken: boolean,
): PveTransport {
  if (config.transport !== "auto") return config.transport;
  return hasToken ? "tunnel" : "pvesh";
}

async function readHostConfig(
  ctx: PluginContext,
  hostId: number,
): Promise<{ config: PveHostConfig; token: PveApiToken | null }> {
  const keys = [
    SETTINGS.transport,
    SETTINGS.tokenId,
    SETTINGS.apiHost,
    SETTINGS.apiPort,
    SETTINGS.caCert,
  ];
  const values = await Promise.all(
    keys.map((key) => ctx.settings.getHost(hostId, key)),
  );
  const config = parseHostConfig(
    Object.fromEntries(keys.map((key, i) => [key, values[i]])),
  );
  const secret = await ctx.settings.getHost<unknown>(
    hostId,
    SETTINGS.tokenSecret,
  );
  const token =
    config.tokenId && typeof secret === "string" && secret
      ? { tokenId: config.tokenId, secret }
      : null;
  return { config, token };
}

function requireToken(token: PveApiToken | null): PveApiToken {
  if (!token) {
    throw new PveError(
      "This host has no Proxmox API token. Add one in the host's Proxmox settings, or connect with pvesh over SSH.",
      "PVE_AUTH_FAILED",
      400,
    );
  }
  if (!isValidTokenId(token.tokenId)) {
    throw new PveError(
      "The API token ID must look like user@realm!name",
      "PVE_BAD_REQUEST",
      400,
    );
  }
  return token;
}

/**
 * Runs fn with a client for the Proxmox node behind a Termix host, as the
 * acting user. SSH transports borrow a pooled connection, so core checks
 * access to the host the same way it does for a terminal.
 */
export async function withPveClient<T>(
  ctx: PluginContext,
  hostId: number,
  fn: (client: PveClient) => Promise<T>,
): Promise<T> {
  const { config, token } = await readHostConfig(ctx, hostId);
  const transport = resolveTransport(config, !!token);

  if (transport === "direct") {
    const host = await ctx.hosts.get(hostId);
    if (!host) throw new PveError("Host not found", "PVE_NOT_FOUND", 404);
    return fn(
      createDirectClient(ctx.fetch, {
        host: config.apiHost ?? String(host.ip),
        port: config.apiPort,
        token: requireToken(token),
        caCert: config.caCert,
      }),
    );
  }

  if (transport === "tunnel") {
    const apiToken = requireToken(token);
    return ctx.ssh.withConnection<T, Client>(
      hostId,
      { pool: "pve-api", purpose: "proxmox" },
      (client) =>
        fn(
          createTunnelClient(
            sshForwardOpener(client, config.apiPort),
            apiToken,
          ),
        ),
    );
  }

  const resolved = await ctx.ssh.resolveHost(hostId).catch(() => null);
  const sudoPassword =
    (resolved?.sudoPassword as string | undefined) || undefined;
  return ctx.ssh.withConnection<T, Client>(
    hostId,
    { pool: "pve-api", purpose: "proxmox" },
    (client) => fn(createPveshClient(createPveshRunner(client, sudoPassword))),
  );
}
