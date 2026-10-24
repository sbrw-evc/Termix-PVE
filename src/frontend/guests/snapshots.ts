/** One entry of GET /nodes/{node}/{type}/{vmid}/snapshot. */
export interface Snapshot {
  name: string;
  description?: string;
  /** Seconds since the epoch; missing on "current". */
  snaptime?: number;
  parent?: string;
  /** VMs: the snapshot holds the RAM, so rolling back resumes the VM. */
  vmstate?: number;
  /** Only on "current", the state the guest runs in now. */
  running?: number;
}

/** The pseudo snapshot Proxmox lists for the guest's live state. */
export const CURRENT = "current";

export interface SnapshotRow {
  snapshot: Snapshot;
  depth: number;
}

/**
 * Snapshots in tree order, as Proxmox draws them: each parent above its
 * children, oldest first, "current" under the snapshot it runs from.
 */
export function snapshotTree(list: Snapshot[]): SnapshotRow[] {
  const names = new Set(list.map((s) => s.name));
  const children = new Map<string, Snapshot[]>();
  const roots: Snapshot[] = [];
  for (const snap of list) {
    // A parent that is gone (deleted) makes its child a root.
    if (snap.parent && names.has(snap.parent)) {
      const siblings = children.get(snap.parent) ?? [];
      siblings.push(snap);
      children.set(snap.parent, siblings);
    } else {
      roots.push(snap);
    }
  }
  // "current" has no time and goes after its siblings.
  const order = (a: Snapshot, b: Snapshot) =>
    (a.snaptime ?? Infinity) - (b.snaptime ?? Infinity) ||
    a.name.localeCompare(b.name);
  const rows: SnapshotRow[] = [];
  const walk = (snaps: Snapshot[], depth: number) => {
    for (const snap of [...snaps].sort(order)) {
      rows.push({ snapshot: snap, depth });
      walk(children.get(snap.name) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  return rows;
}

/** Proxmox's rule for a snapshot name: a letter, then up to 39 letters, digits, - or _. */
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/;

export function snapshotNameProblem(
  name: string,
  existing: Snapshot[],
): "format" | "taken" | "reserved" | null {
  if (name === CURRENT) return "reserved";
  if (!NAME_RE.test(name)) return "format";
  if (existing.some((s) => s.name === name)) return "taken";
  return null;
}

/** A default name like Proxmox users type: the date and time, made valid. */
export function suggestSnapshotName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `snap_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}
