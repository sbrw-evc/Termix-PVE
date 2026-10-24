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
