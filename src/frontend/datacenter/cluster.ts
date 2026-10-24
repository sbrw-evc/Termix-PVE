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
