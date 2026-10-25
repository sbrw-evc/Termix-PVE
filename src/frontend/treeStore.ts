import { useSyncExternalStore } from "react";
import type { PveCallError, PveResource } from "./api";
import type { TreeView } from "./tree";

/** One Proxmox host's /cluster/resources, as the Proxmox tab last loaded it. */
export interface ClusterState {
  resources: PveResource[] | null;
  error: PveCallError | null;
}

/**
 * What the Proxmox tab and the tree in the left sidebar share: the tab loads
 * the clusters and shows the details, the sidebar draws the tree, and either
 * can change what is selected. They render apart, so this lives outside React.
 */
export interface TreeState {
  hosts: Array<{ id: number; name: string }>;
  clusters: Record<number, ClusterState>;
  query: string;
  selection: string | null;
  view: TreeView;
  /** The sidebar tree is the one on screen, so the tab leaves its own out. */
  inSidebar: boolean;
}

const VIEW_KEY = "pve.treeView";

/** The tree layout this browser last used; Folder View like Proxmox's by default. */
function readView(): TreeView {
  try {
    return localStorage.getItem(VIEW_KEY) === "server" ? "server" : "folder";
  } catch {
    return "folder";
  }
}

let state: TreeState = {
  hosts: [],
  clusters: {},
  query: "",
  selection: null,
  view: readView(),
  inSidebar: false,
};
const listeners = new Set<() => void>();

export function getTreeState(): TreeState {
  return state;
}

export function setTreeState(patch: Partial<TreeState>): void {
  const next = { ...state, ...patch };
  if (patch.view && patch.view !== state.view) {
    try {
      localStorage.setItem(VIEW_KEY, patch.view);
    } catch {
      // Storage off: the choice lasts until the page reloads.
    }
  }
  // Nothing changed: don't wake every subscriber.
  if (
    Object.keys(patch).every(
      (k) => next[k as keyof TreeState] === state[k as keyof TreeState],
    )
  )
    return;
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeTree(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTreeState(): TreeState {
  return useSyncExternalStore(subscribeTree, getTreeState, getTreeState);
}

/** For tests: back to a fresh state. */
export function resetTreeState(): void {
  state = {
    hosts: [],
    clusters: {},
    query: "",
    selection: null,
    view: "folder",
    inSidebar: false,
  };
  for (const listener of listeners) listener();
}
