import { afterEach, describe, expect, it } from "vitest";
import {
  getTreeState,
  resetTreeState,
  setTreeState,
  subscribeTree,
} from "../../src/frontend/treeStore";

afterEach(() => resetTreeState());

describe("tree store", () => {
  it("shares the selection between the tab and the sidebar", () => {
    let calls = 0;
    const stop = subscribeTree(() => calls++);
    setTreeState({ selection: "16|node/proxmox" });
    expect(getTreeState().selection).toBe("16|node/proxmox");
    expect(calls).toBe(1);
    // The same value again wakes no one.
    setTreeState({ selection: "16|node/proxmox" });
    expect(calls).toBe(1);
    stop();
    setTreeState({ query: "npm" });
    expect(calls).toBe(1);
  });

  it("remembers the tree view in this browser", () => {
    setTreeState({ view: "server" });
    expect(localStorage.getItem("pve.treeView")).toBe("server");
  });
});
