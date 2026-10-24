import { describe, expect, it } from "vitest";
import {
  findRule,
  hostLevelFor,
  paramsAllowed,
  RULES,
} from "../../src/backend/pve/policy.js";
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
    // Logging in, writing node files, the node's own config.
    expect(findRule("POST", split("access/ticket"))).toBeNull();
    expect(findRule("GET", split("access/permissions"))).toBeNull();
    // Users are listed, but only for administer.
    expect(findRule("GET", split("access/users"))?.permission).toBe(
      "administer",
    );
    expect(findRule("POST", split("nodes/pve1/execute"))).toBeNull();
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
      // Changes never pass with view. Reads are view, or administer for
      // a node's logs.
      if (rule.method !== "GET") expect(rule.permission).not.toBe("view");
      else expect(["view", "administer"]).toContain(rule.permission);
    }
  });

  it("asks for edit access to the host to change anything", () => {
    expect(hostLevelFor("view")).toBe("connect");
    expect(hostLevelFor("operate")).toBe("edit");
    expect(hostLevelFor("administer")).toBe("edit");
  });
});

describe("phase 2 rules", () => {
  it("lets guests be configured with configure", () => {
    expect(
      findRule("PUT", split("nodes/pve1/qemu/100/config"))?.permission,
    ).toBe("configure");
    expect(
      findRule("PUT", split("nodes/pve1/lxc/400/resize"))?.permission,
    ).toBe("configure");
    expect(
      findRule("POST", split("nodes/pve1/qemu/100/move_disk"))?.permission,
    ).toBe("configure");
    expect(findRule("POST", split("nodes/pve1/lxc/400/move_disk"))).toBeNull();
  });

  it("takes a volume id as one segment", () => {
    expect(
      findRule("DELETE", [
        "nodes",
        "pve1",
        "storage",
        "local",
        "content",
        "local:iso/debian.iso",
      ])?.permission,
    ).toBe("configure");
  });

  it("keeps node logs and power behind administer", () => {
    expect(findRule("GET", split("nodes/pve1/syslog"))?.permission).toBe(
      "administer",
    );
    expect(findRule("POST", split("nodes/pve1/status"))?.permission).toBe(
      "administer",
    );
    expect(
      findRule("POST", split("nodes/pve1/services/pveproxy/restart"))
        ?.permission,
    ).toBe("administer");
    expect(
      findRule("POST", split("nodes/pve1/services/pveproxy/disable")),
    ).toBeNull();
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

describe("node system rules", () => {
  it("reads node settings with view and changes them with administer", () => {
    for (const path of [
      "nodes/pve1/dns",
      "nodes/pve1/hosts",
      "nodes/pve1/time",
      "nodes/pve1/certificates/info",
      "nodes/pve1/apt/repositories",
      "nodes/pve1/disks/lvm",
      "nodes/pve1/disks/lvmthin",
      "nodes/pve1/disks/directory",
      "nodes/pve1/disks/zfs",
      "nodes/pve1/tasks",
    ]) {
      expect(findRule("GET", split(path))?.permission).toBe("view");
    }
    expect(findRule("PUT", split("nodes/pve1/dns"))?.permission).toBe(
      "administer",
    );
    expect(findRule("POST", split("nodes/pve1/hosts"))?.permission).toBe(
      "administer",
    );
    expect(findRule("PUT", split("nodes/pve1/time"))?.permission).toBe(
      "administer",
    );
    expect(
      findRule("POST", split("nodes/pve1/apt/repositories"))?.permission,
    ).toBe("administer");
    expect(
      findRule("PUT", split("nodes/pve1/apt/repositories"))?.permission,
    ).toBe("administer");
  });

  it("creates and removes disk storage and certificates with administer", () => {
    for (const [method, path] of [
      ["POST", "nodes/pve1/disks/lvm"],
      ["POST", "nodes/pve1/disks/zfs"],
      ["DELETE", "nodes/pve1/disks/lvmthin/data"],
      ["POST", "nodes/pve1/disks/initgpt"],
      ["PUT", "nodes/pve1/disks/wipedisk"],
      ["POST", "nodes/pve1/certificates/custom"],
      ["DELETE", "nodes/pve1/certificates/custom"],
      ["POST", "nodes/pve1/certificates/acme/certificate"],
      ["PUT", "nodes/pve1/certificates/acme/certificate"],
      ["GET", "cluster/acme/account"],
      ["POST", "cluster/acme/account"],
      ["GET", "cluster/acme/plugins"],
      ["DELETE", "cluster/acme/plugins/cf"],
      ["PUT", "nodes/pve1/config"],
    ] as const) {
      expect(findRule(method, split(path))?.permission).toBe("administer");
    }
    expect(findRule("GET", split("cluster/acme/directories"))?.permission).toBe(
      "view",
    );
    expect(findRule("POST", split("nodes/pve1/disks/other"))).toBeNull();
  });

  it("allows guest snapshots at the right level", () => {
    const base = "nodes/pve1/qemu/100/snapshot";
    expect(findRule("GET", split(base))?.permission).toBe("view");
    expect(findRule("POST", split(base))?.permission).toBe("configure");
    expect(findRule("POST", split(`${base}/before/rollback`))?.permission).toBe(
      "configure",
    );
    expect(findRule("DELETE", split(`${base}/before`))?.permission).toBe(
      "configure",
    );
    expect(
      findRule("PUT", split("nodes/pve1/lxc/400/snapshot/before/config"))
        ?.permission,
    ).toBe("configure");
  });

  it("lets the node config change only ACME, notes and options", () => {
    const rule = findRule("PUT", split("nodes/pve1/config"))!;
    expect(
      paramsAllowed(rule, {
        acme: "account=le",
        acmedomain0: "domain=a.example.com",
        delete: "acmedomain1,acmedomain2",
        digest: "x",
      }),
    ).toBe(true);
    expect(
      paramsAllowed(rule, {
        description: "hi",
        "startall-onboot-delay": 10,
        wakeonlan: "aa:bb:cc:dd:ee:ff",
      }),
    ).toBe(true);
    expect(paramsAllowed(rule, { delete: "description,wakeonlan" })).toBe(true);
    expect(paramsAllowed(rule, { "ballooning-target": 80 })).toBe(false);
    expect(paramsAllowed(rule, { delete: "ballooning-target" })).toBe(false);
    expect(paramsAllowed(rule, { delete: "acme;location" })).toBe(false);
    // Rules without a list take any parameters.
    expect(
      paramsAllowed(findRule("PUT", split("nodes/pve1/dns"))!, { x: 1 }),
    ).toBe(true);
  });
});
