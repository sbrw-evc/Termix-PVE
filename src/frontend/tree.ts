import type { PveResource } from "./api";

export interface NodeBranch {
  node: PveResource;
  guests: PveResource[];
  storage: PveResource[];
}

export function isGuest(resource: PveResource): boolean {
  return resource.type === "qemu" || resource.type === "lxc";
}

/** A guest's label as Proxmox shows it: "100 (web)". */
export function guestLabel(resource: PveResource): string {
  return resource.name
    ? `${resource.vmid} (${resource.name})`
    : String(resource.vmid ?? resource.id);
}

function matches(resource: PveResource, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [
    resource.name,
    resource.node,
    resource.storage,
    resource.pool,
    (resource as PveResource & { sdn?: string }).sdn,
    resource.tags,
    resource.vmid !== undefined ? String(resource.vmid) : undefined,
  ].some((value) => value?.toLowerCase().includes(q));
}

/**
 * Groups /cluster/resources into nodes with their guests and storage, the
 * way the Proxmox server view does. A search keeps a node when the node
 * itself or anything under it matches.
 */
export function buildResourceTree(
  resources: PveResource[],
  query = "",
): NodeBranch[] {
  const branches = new Map<string, NodeBranch>();
  const branchFor = (name: string): NodeBranch => {
    let branch = branches.get(name);
    if (!branch) {
      branch = {
        node: {
          id: `node/${name}`,
          type: "node",
          node: name,
          status: "unknown",
        },
        guests: [],
        storage: [],
      };
      branches.set(name, branch);
    }
    return branch;
  };

  for (const resource of resources) {
    if (!resource.node) continue;
    if (resource.type === "node") branchFor(resource.node).node = resource;
  }
  for (const resource of resources) {
    if (!resource.node) continue;
    if (isGuest(resource)) branchFor(resource.node).guests.push(resource);
    else if (resource.type === "storage")
      branchFor(resource.node).storage.push(resource);
  }

  const result: NodeBranch[] = [];
  for (const branch of branches.values()) {
    const nodeMatches = matches(branch.node, query);
    const guests = branch.guests
      .filter((g) => nodeMatches || matches(g, query))
      .sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0));
    const storage = branch.storage
      .filter((s) => nodeMatches || matches(s, query))
      .sort((a, b) => (a.storage ?? "").localeCompare(b.storage ?? ""));
    if (!nodeMatches && !guests.length && !storage.length) continue;
    result.push({ node: branch.node, guests, storage });
  }
  return result.sort((a, b) =>
    (a.node.node ?? "").localeCompare(b.node.node ?? ""),
  );
}

export function guestCounts(resources: PveResource[]): {
  running: number;
  total: number;
} {
  const guests = resources.filter((r) => isGuest(r) && !r.template);
  return {
    running: guests.filter((g) => g.status === "running").length,
    total: guests.length,
  };
}

/** What a row draws: a resource, or a folder that only groups others. */
export type TreeKind =
  | "datacenter"
  | "folder"
  | "node"
  | "qemu"
  | "lxc"
  | "storage"
  | "pool"
  | "sdn";

export interface TreeItem {
  key: string;
  label: string;
  kind: TreeKind;
  /** Set on rows that are a resource; folders have none. */
  resource?: PveResource;
  children?: TreeItem[];
}

export type TreeView = "folder" | "server";

const FOLDERS: Array<{ type: string; label: string }> = [
  { type: "lxc", label: "tree.folders.lxc" },
  { type: "qemu", label: "tree.folders.qemu" },
  { type: "node", label: "tree.folders.node" },
  { type: "pool", label: "tree.folders.pool" },
  { type: "sdn", label: "tree.folders.sdn" },
  { type: "storage", label: "tree.folders.storage" },
];

function resourceLabel(r: PveResource, withNode: boolean): string {
  if (isGuest(r)) return guestLabel(r);
  if (r.type === "node") return r.node ?? r.id;
  const name =
    r.type === "storage"
      ? r.storage
      : r.type === "pool"
        ? r.pool
        : ((r as PveResource & { sdn?: string }).sdn ?? r.id);
  return withNode && r.node ? `${name} (${r.node})` : (name ?? r.id);
}

function item(r: PveResource, withNode: boolean): TreeItem {
  return {
    key: r.id,
    label: resourceLabel(r, withNode),
    kind: r.type as TreeKind,
    resource: r,
  };
}

const byLabel = (a: TreeItem, b: TreeItem) => {
  const va = a.resource?.vmid;
  const vb = b.resource?.vmid;
  if (va !== undefined && vb !== undefined) return va - vb;
  return a.label.localeCompare(b.label);
};

/**
 * Proxmox's Folder View: one folder per kind of resource under the
 * datacenter. Labels are translation keys; the caller translates them.
 * Empty folders are left out.
 */
export function buildFolderTree(
  resources: PveResource[],
  query = "",
): TreeItem[] {
  const folders: TreeItem[] = [];
  for (const folder of FOLDERS) {
    const children = resources
      .filter((r) => r.type === folder.type && matches(r, query))
      .map((r) => item(r, folder.type !== "node" && !isGuest(r)))
      .sort(byLabel);
    if (children.length) {
      folders.push({
        key: `folder/${folder.type}`,
        label: folder.label,
        kind: "folder",
        children,
      });
    }
  }
  return [
    {
      key: "datacenter",
      label: "tree.datacenter",
      kind: "datacenter",
      children: folders,
    },
  ];
}

/** Proxmox's Server View: nodes with their guests and storage. */
export function buildServerTree(
  resources: PveResource[],
  query = "",
): TreeItem[] {
  return buildResourceTree(resources, query).map((branch) => ({
    ...item(branch.node, false),
    children: [
      ...branch.guests.map((g) => item(g, false)),
      ...branch.storage.map((s) => item(s, false)),
    ],
  }));
}
