import { describe, expect, it } from "vitest";
import {
  addableRepos,
  certState,
  commonName,
  dnsForm,
  dnsParams,
  dnsProblem,
  nodeClock,
  repoRows,
  taskParams,
  taskState,
  timeZones,
  volumeGroups,
  type AptRepositories,
} from "../../src/frontend/nodes/system";

describe("node DNS", () => {
  it("reads and checks the form", () => {
    const form = dnsForm({ search: "evcsbrw.ru", dns1: "8.8.8.8" });
    expect(form).toEqual({
      search: "evcsbrw.ru",
      servers: ["8.8.8.8", "", ""],
    });
    expect(dnsProblem(form)).toBeNull();
    expect(dnsProblem({ ...form, search: "" })).toBe("search");
    expect(dnsProblem({ ...form, servers: ["8.8.8", "", ""] })).toBe("server");
    expect(dnsProblem({ ...form, servers: ["", "", ""] })).toBe("noServer");
    expect(
      dnsProblem({ ...form, servers: ["2606:4700::1111", "", ""] }),
    ).toBeNull();
  });

  it("moves servers up over empty ones", () => {
    expect(
      dnsParams({ search: " lan ", servers: ["", "1.1.1.1", " 9.9.9.9 "] }),
    ).toEqual({
      search: "lan",
      dns1: "1.1.1.1",
      dns2: "9.9.9.9",
      dns3: undefined,
    });
  });
});

describe("node time and certificates", () => {
  it("shows the node's own wall clock", () => {
    // 2026-10-24 12:00:00 local, as PVE sends it.
    expect(
      nodeClock({
        timezone: "Europe/Moscow",
        time: 1792843200 - 3 * 3600,
        localtime: 1792843200,
      }),
    ).toBe("2026-10-24 12:00:00");
  });

  it("offers the node's zone even if the browser lacks it", () => {
    expect(timeZones("Mars/Olympus")).toContain("Mars/Olympus");
    expect(timeZones("UTC")).toContain("UTC");
  });

  it("names certificates and their state", () => {
    expect(commonName("/OU=PVE Cluster Node/CN=proxmox.lan")).toBe(
      "proxmox.lan",
    );
    expect(commonName("/O=Only")).toBe("/O=Only");
    const now = 1_800_000_000;
    expect(certState({ filename: "a", notafter: now + 90 * 86400 }, now)).toBe(
      "valid",
    );
    expect(certState({ filename: "a", notafter: now + 5 * 86400 }, now)).toBe(
      "expiring",
    );
    expect(certState({ filename: "a", notafter: now - 1 }, now)).toBe(
      "expired",
    );
    expect(certState({ filename: "a", notbefore: now + 10 }, now)).toBe(
      "notYet",
    );
  });
});

describe("node repositories", () => {
  const data: AptRepositories = {
    digest: "d",
    files: [
      {
        path: "/etc/apt/sources.list.d/proxmox.sources",
        repositories: [
          {
            Types: ["deb"],
            URIs: ["http://download.proxmox.com/debian/pve"],
            Suites: ["trixie"],
            Components: ["pve-no-subscription"],
            Enabled: 1,
          },
          {
            Types: ["deb"],
            URIs: ["https://enterprise.proxmox.com/debian/pve"],
            Suites: ["trixie"],
            Components: ["pve-enterprise"],
            Enabled: 0,
          },
        ],
      },
    ],
    infos: [
      {
        path: "/etc/apt/sources.list.d/proxmox.sources",
        index: 0,
        kind: "origin",
        message: "Proxmox",
      },
      {
        path: "/etc/apt/sources.list.d/proxmox.sources",
        index: 0,
        kind: "warning",
        message: "not for production",
      },
    ],
    "standard-repos": [
      { handle: "enterprise", name: "Enterprise", status: 0 },
      { handle: "test", name: "Test", status: null },
    ],
  };

  it("lists each repository with its origin and warnings", () => {
    const rows = repoRows(data);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      index: 0,
      enabled: true,
      line: "deb http://download.proxmox.com/debian/pve trixie pve-no-subscription",
      origin: "Proxmox",
      warnings: ["not for production"],
    });
    expect(rows[1]).toMatchObject({ index: 1, enabled: false, origin: null });
    expect(repoRows(null)).toEqual([]);
  });

  it("offers only standard repositories not set up yet", () => {
    expect(addableRepos(data).map((r) => r.handle)).toEqual(["test"]);
  });
});

describe("node tasks and disks", () => {
  it("builds task filters", () => {
    expect(
      taskParams(
        { errorsOnly: true, type: " vzdump ", vmid: "300", user: "" },
        50,
      ),
    ).toEqual({
      start: 50,
      limit: 50,
      errors: true,
      typefilter: "vzdump",
      vmid: 300,
      userfilter: undefined,
    });
    expect(
      taskParams({ errorsOnly: false, type: "", vmid: "abc", user: "" }, 0)
        .vmid,
    ).toBeUndefined();
  });

  it("reads a task's state", () => {
    const base = {
      upid: "u",
      node: "n",
      type: "t",
      user: "root@pam",
      starttime: 1,
    };
    expect(taskState(base)).toBe("running");
    expect(taskState({ ...base, endtime: 2, status: "OK" })).toBe("ok");
    expect(taskState({ ...base, endtime: 2, status: "job errors" })).toBe(
      "error",
    );
  });

  it("reads volume groups", () => {
    expect(
      volumeGroups({ children: [{ name: "pve", size: 10, free: 2 }] }),
    ).toEqual([{ name: "pve", size: 10, free: 2 }]);
    expect(volumeGroups(null)).toEqual([]);
  });
});
