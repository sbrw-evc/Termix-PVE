import { describe, expect, it } from "vitest";
import { findRule, hostLevelFor, RULES } from "../../src/backend/pve/policy.js";
import { parseCallBody } from "../../src/backend/routes.js";

const split = (path: string) => path.split("/");

describe("findRule", () => {
  it("lets reads through with view", () => {
    expect(findRule("GET", split("cluster/resources"))?.permission).toBe(
      "view",
    );
    expect(
      findRule("GET", split("nodes/pve1/qemu/100/rrddata"))?.permission,
    ).toBe("view");
    expect(
      findRule("GET", split("nodes/pve1/lxc/400/status/current"))?.permission,
    ).toBe("view");
  });

  it("asks operate for power and configure for changes", () => {
    expect(
      findRule("POST", split("nodes/pve1/lxc/400/status/start"))?.permission,
    ).toBe("operate");
    expect(
      findRule("POST", split("nodes/pve1/qemu/100/status/reset"))?.permission,
    ).toBe("operate");
    expect(findRule("POST", split("nodes/pve1/lxc"))?.permission).toBe(
      "configure",
    );
    expect(
      findRule("POST", split("nodes/pve1/qemu/100/clone"))?.permission,
    ).toBe("configure");
    expect(findRule("DELETE", split("nodes/pve1/qemu/100"))?.permission).toBe(
      "configure",
    );
  });

  it("refuses paths and methods no rule lists", () => {
    // Writing a node's files, shutting the node down, reading access lists.
    expect(findRule("POST", split("nodes/pve1/status"))).toBeNull();
    expect(findRule("GET", split("access/users"))).toBeNull();
    expect(findRule("PUT", split("nodes/pve1/qemu/100/config"))).toBeNull();
    expect(
      findRule("POST", split("nodes/pve1/qemu/100/status/hibernate")),
    ).toBeNull();
    expect(
      findRule("DELETE", split("nodes/pve1/storage/local/content")),
    ).toBeNull();
    expect(findRule("GET", split("cluster/resources/extra"))).toBeNull();
  });

  it("only uses known methods and permissions", () => {
    for (const rule of RULES) {
      expect(["GET", "POST", "PUT", "DELETE"]).toContain(rule.method);
      expect(["view", "operate", "configure", "administer"]).toContain(
        rule.permission,
      );
      // Reads never need more than view, changes never pass with view.
      expect(rule.method === "GET").toBe(rule.permission === "view");
    }
  });

  it("asks for edit access to the host to change anything", () => {
    expect(hostLevelFor("view")).toBe("connect");
    expect(hostLevelFor("operate")).toBe("edit");
    expect(hostLevelFor("administer")).toBe("edit");
  });
});

describe("parseCallBody", () => {
  it("takes a method, a path and params", () => {
    expect(
      parseCallBody({
        method: "post",
        path: ["nodes", "pve1", "lxc", 400, "status", "start"],
        params: { timeout: 30, force: true, note: null },
      }),
    ).toEqual({
      method: "POST",
      path: ["nodes", "pve1", "lxc", "400", "status", "start"],
      params: { timeout: 30, force: true, note: null },
    });
    expect(parseCallBody({ path: ["version"] })).toMatchObject({
      method: "GET",
      params: {},
    });
  });

  it("refuses bodies it can't trust", () => {
    expect(parseCallBody({ method: "PATCH", path: ["version"] })).toBe(
      "Unknown method",
    );
    expect(parseCallBody({ path: "nodes/pve1" })).toMatch(/path/);
    expect(parseCallBody({ path: [] })).toMatch(/path/);
    expect(parseCallBody({ path: [""] })).toMatch(/path/);
    expect(parseCallBody({ path: Array(13).fill("a") })).toMatch(/path/);
    expect(parseCallBody({ path: ["a"], params: [] })).toMatch(/params/);
    expect(parseCallBody({ path: ["a"], params: { x: { y: 1 } } })).toMatch(
      /params/,
    );
  });
});
