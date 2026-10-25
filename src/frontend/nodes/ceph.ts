import type { PveParams } from "../api";

/** Why the status call failed: packages missing, or installed but not set up. */
export type CephSetupState = "ready" | "install" | "init" | "error";

export function cephSetupState(error: string | null): CephSetupState {
  if (!error) return "ready";
  if (/binary not installed|not installed|no such file/i.test(error))
    return "install";
  if (/not initialized|ceph\.conf|rados_connect|got timeout/i.test(error))
    return "init";
  return "error";
}

/** A node of GET /nodes/{node}/ceph/osd: root > hosts > OSDs. */
export interface OsdTreeNode {
  id: number;
  name: string;
  type: string;
  status?: "up" | "down";
  in?: number;
  host?: string;
  device_class?: string;
  crush_weight?: number;
  percent_used?: number;
  total_space?: number;
  osdtype?: string;
  children?: OsdTreeNode[];
}

export interface OsdRow {
  id: number;
  name: string;
  host: string;
  up: boolean;
  in: boolean;
  deviceClass: string;
  weight?: number;
  used?: number;
  size?: number;
}

/** Every OSD of the tree with the host it sits on. */
export function flattenOsds(data: unknown): OsdRow[] {
  const root = (data as { root?: OsdTreeNode } | null)?.root;
  const out: OsdRow[] = [];
  const walk = (node: OsdTreeNode, host: string) => {
    if (node.type === "osd") {
      out.push({
        id: node.id,
        name: node.name,
        host: node.host ?? host,
        up: node.status === "up",
        in: node.in === 1,
        deviceClass: node.device_class ?? "",
        weight: node.crush_weight,
        used: node.percent_used,
        size: node.total_space,
      });
      return;
    }
    for (const child of node.children ?? [])
      walk(child, node.type === "host" ? node.name : host);
  };
  if (root) walk(root, "");
  return out.sort((a, b) => a.id - b.id);
}

const CIDR = /^[0-9a-fA-F:.]+\/\d{1,3}$/;

export interface CephInitForm {
  network: string;
  clusterNetwork: string;
  size: string;
  minSize: string;
}

export function cephInitProblem(f: CephInitForm): string | null {
  if (f.network && !CIDR.test(f.network)) return "network";
  if (f.clusterNetwork && !CIDR.test(f.clusterNetwork)) return "network";
  const size = Number(f.size);
  const min = Number(f.minSize);
  if (!Number.isInteger(size) || size < 1 || size > 7) return "size";
  if (!Number.isInteger(min) || min < 1 || min > size) return "minSize";
  return null;
}

export function cephInitParams(f: CephInitForm): PveParams {
  return {
    network: f.network.trim() || undefined,
    "cluster-network": f.clusterNetwork.trim() || undefined,
    size: Number(f.size),
    min_size: Number(f.minSize),
  };
}

export interface OsdForm {
  dev: string;
  dbDev: string;
  dbSize: string;
  walDev: string;
  walSize: string;
  encrypted: boolean;
  deviceClass: string;
}

export function osdParams(f: OsdForm): PveParams {
  return {
    dev: f.dev,
    db_dev: f.dbDev || undefined,
    db_dev_size: f.dbDev && f.dbSize ? Number(f.dbSize) : undefined,
    wal_dev: f.walDev || undefined,
    wal_dev_size: f.walDev && f.walSize ? Number(f.walSize) : undefined,
    encrypted: f.encrypted || undefined,
    "crush-device-class": f.deviceClass.trim() || undefined,
  };
}

export function osdProblem(f: OsdForm): string | null {
  if (!f.dev) return "dev";
  if (f.dbDev && f.dbDev === f.dev) return "sameDisk";
  if (f.walDev && f.walDev === f.dev) return "sameDisk";
  for (const v of [f.dbSize, f.walSize]) {
    if (v && !(Number(v) > 0)) return "sizeGiB";
  }
  return null;
}
