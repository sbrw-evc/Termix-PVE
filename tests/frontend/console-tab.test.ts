import { describe, expect, it } from "vitest";
import { readConsoleTabData } from "../../src/frontend/guests/console/ConsoleTab";

describe("console tab", () => {
  it("reads the guest a console tab was opened for", () => {
    expect(readConsoleTabData({ node: "pve", type: "lxc", vmid: 300 })).toEqual(
      { node: "pve", type: "lxc", vmid: 300 },
    );
    // Restored tabs may carry the id as a string.
    expect(
      readConsoleTabData({ node: "pve", type: "qemu", vmid: "101" }),
    ).toEqual({ node: "pve", type: "qemu", vmid: 101 });
  });

  it("refuses a tab opened without a guest", () => {
    expect(readConsoleTabData(undefined)).toBeNull();
    expect(
      readConsoleTabData({ node: "pve", type: "node", vmid: 1 }),
    ).toBeNull();
    expect(
      readConsoleTabData({ node: "pve", type: "lxc", vmid: 0 }),
    ).toBeNull();
  });
});
