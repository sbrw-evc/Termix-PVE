import { describe, expect, it } from "vitest";
import {
  snapshotNameProblem,
  snapshotTree,
  suggestSnapshotName,
  type Snapshot,
} from "../../src/frontend/guests/snapshots";

const list: Snapshot[] = [
  { name: "current", parent: "after", running: 1 },
  { name: "after", parent: "base", snaptime: 300 },
  { name: "branch", parent: "base", snaptime: 200 },
  { name: "base", snaptime: 100 },
  { name: "orphan", parent: "deleted", snaptime: 50 },
];

describe("snapshots", () => {
  it("orders snapshots as a tree with current under its parent", () => {
    expect(
      snapshotTree(list).map((r) => `${r.depth}:${r.snapshot.name}`),
    ).toEqual(["0:orphan", "0:base", "1:branch", "1:after", "2:current"]);
  });

  it("checks names", () => {
    expect(snapshotNameProblem("before_upgrade", list)).toBeNull();
    expect(snapshotNameProblem("base", list)).toBe("taken");
    expect(snapshotNameProblem("current", list)).toBe("reserved");
    expect(snapshotNameProblem("1st", list)).toBe("format");
    expect(snapshotNameProblem("a", list)).toBe("format");
    expect(snapshotNameProblem("with space", list)).toBe("format");
  });

  it("suggests a valid name", () => {
    const name = suggestSnapshotName(new Date(2026, 9, 24, 9, 5));
    expect(name).toBe("snap_20261024_0905");
    expect(snapshotNameProblem(name, list)).toBeNull();
  });
});
