/** One entry of GET /cluster/status. */
export interface ClusterStatusEntry {
  type: "cluster" | "node";
  name: string;
  id?: string;
  /** Cluster entry. */
  quorate?: number;
  nodes?: number;
  version?: number;
  /** Node entries. */
  online?: number;
  ip?: string;
  local?: number;
  nodeid?: number;
}

/** GET /cluster/config/join. */
export interface ClusterJoin {
  preferred_node: string;
  nodelist: Array<{
    name: string;
    pve_addr: string;
    pve_fp: string;
    quorum_votes?: string;
    ring0_addr?: string;
    [link: string]: unknown;
  }>;
  totem: Record<string, unknown>;
  config_digest?: string;
}

export function clusterOf(status: ClusterStatusEntry[]) {
  return status.find((e) => e.type === "cluster") ?? null;
}

/**
 * The text Proxmox's "Join Information" copies: base64 of the preferred
 * node's address, fingerprint and links, which a joining node pastes in.
 */
export function joinInformation(join: ClusterJoin): string | null {
  const node =
    join.nodelist.find((n) => n.name === join.preferred_node) ??
    join.nodelist[0];
  if (!node) return null;
  const peerLinks: Record<string, string> = {};
  for (const [key, value] of Object.entries(node)) {
    const link = /^ring(\d)_addr$/.exec(key);
    if (link && typeof value === "string") peerLinks[link[1]] = value;
  }
  const info = {
    ipAddress: node.pve_addr,
    fingerprint: node.pve_fp,
    peerLinks,
    ring_addr: Object.values(peerLinks),
    totem: join.totem,
  };
  // btoa only takes Latin-1, so go through UTF-8 bytes.
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(info))) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** What a pasted Join Information holds, or null if it is not one. */
export function parseJoinInformation(text: string): {
  ipAddress: string;
  fingerprint: string;
  peerLinks: Record<string, string>;
} | null {
  try {
    const binary = atob(text.trim());
    const json = new TextDecoder().decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    );
    const info = JSON.parse(json) as {
      ipAddress?: string;
      fingerprint?: string;
      peerLinks?: Record<string, string>;
    };
    if (!info.ipAddress || !info.fingerprint) return null;
    return {
      ipAddress: info.ipAddress,
      fingerprint: info.fingerprint,
      peerLinks: info.peerLinks ?? {},
    };
  } catch {
    return null;
  }
}

/** Corosync allows up to 15 letters, digits and dashes for the name. */
export const CLUSTER_NAME = /^[A-Za-z0-9-]{1,15}$/;
const IP = /^[0-9a-fA-F:.]+$/;

export function createClusterParams(f: {
  name: string;
  link0: string;
  link1: string;
}) {
  return {
    clustername: f.name.trim(),
    link0: f.link0.trim() || undefined,
    link1: f.link1.trim() || undefined,
  };
}

export function createClusterProblem(f: {
  name: string;
  link0: string;
  link1: string;
}): string | null {
  if (!CLUSTER_NAME.test(f.name.trim())) return "name";
  for (const link of [f.link0, f.link1]) {
    if (link.trim() && !IP.test(link.trim())) return "link";
  }
  return null;
}

export function joinClusterParams(f: {
  info: string;
  password: string;
  link0: string;
}) {
  const parsed = parseJoinInformation(f.info);
  return {
    hostname: parsed?.ipAddress,
    fingerprint: parsed?.fingerprint,
    password: f.password,
    link0: f.link0.trim() || undefined,
  };
}
