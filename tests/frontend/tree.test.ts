import { describe, expect, it } from "vitest";
import {
  buildResourceTree,
  guestCounts,
  guestLabel,
} from "../../src/frontend/tree";
import { formatBytes, formatUptime, percent } from "../../src/frontend/format";
import type { PveResource } from "../../src/frontend/api";

const resources: PveResource[] = [
  { id: "node/pve2", type: "node", node: "pve2", status: "online" },
  { id: "node/pve1", type: "node", node: "pve1", status: "online" },
  {
    id: "lxc/300",
    type: "lxc",
    node: "pve1",
    vmid: 300,
    name: "npm",
    status: "running",
  },
  {
    id: "qemu/101",
    type: "qemu",
    node: "pve1",
    vmid: 101,
    name: "win",
    status: "stopped",
  },
  {
    id: "qemu/900",
    type: "qemu",
    node: "pve2",
    vmid: 900,
    name: "tpl",
    status: "stopped",
    template: 1,
  },
  {
    id: "storage/pve1/local",
    type: "storage",
    node: "pve1",
    storage: "local",
    status: "available",
  },
  { id: "pool/prod", type: "pool", pool: "prod" },
];

describe("buildResourceTree", () => {
  it("groups guests and storage under sorted nodes", () => {
    const tree = buildResourceTree(resources);
    expect(tree.map((b) => b.node.node)).toEqual(["pve1", "pve2"]);
    expect(tree[0].guests.map((g) => g.vmid)).toEqual([101, 300]);
    expect(tree[0].storage.map((s) => s.storage)).toEqual(["local"]);
  });

  it("keeps a node whose child matches, with only the matches", () => {
    const tree = buildResourceTree(resources, "NPM");
    expect(tree).toHaveLength(1);
    expect(tree[0].guests.map((g) => g.name)).toEqual(["npm"]);
    expect(tree[0].storage).toEqual([]);
  });

  it("keeps everything under a node that matches by name", () => {
    expect(buildResourceTree(resources, "pve2")[0].guests).toHaveLength(1);
  });

  it("makes a node for guests whose node row is missing", () => {
    const tree = buildResourceTree([
      { id: "lxc/1", type: "lxc", node: "ghost", vmid: 1 },
    ]);
    expect(tree[0].node).toMatchObject({ id: "node/ghost", status: "unknown" });
  });
});

describe("helpers", () => {
  it("counts running guests without templates", () => {
    expect(guestCounts(resources)).toEqual({ running: 1, total: 2 });
  });

  it("labels and formats", () => {
    expect(guestLabel(resources[2])).toBe("300 (npm)");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(undefined)).toBe("-");
    expect(percent(50, 200)).toBe(25);
    expect(percent(0, 200)).toBe(0);
    expect(percent(undefined, undefined)).toBeNull();
    expect(formatUptime(90061)).toBe("1d 1h");
    expect(formatUptime(3720)).toBe("1h 2m");
  });
});
