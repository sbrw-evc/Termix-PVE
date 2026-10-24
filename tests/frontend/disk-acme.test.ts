import { describe, expect, it } from "vitest";
import {
  diskStorageParams,
  diskStorageProblem,
  emptyDiskStorageForm,
  removeParams,
  unusedDisks,
} from "../../src/frontend/nodes/diskCreate";
import {
  accountParams,
  accountProblem,
  acmeConfigParams,
  acmeConfigProblem,
  encodePluginData,
  parseAcmeConfig,
  pluginIdProblem,
} from "../../src/frontend/nodes/acme";

describe("disk storage", () => {
  it("offers only disks with nothing on them", () => {
    expect(
      unusedDisks([
        { devpath: "/dev/sda", used: "LVM" },
        { devpath: "/dev/sdb" },
        { devpath: "/dev/sdc", used: "partitions" },
      ]).map((d) => d.devpath),
    ).toEqual(["/dev/sdb"]);
  });

  it("checks names, disks and ZFS layouts", () => {
    const f = {
      ...emptyDiskStorageForm(),
      name: "data2",
      devices: ["/dev/sdb"],
    };
    expect(diskStorageProblem("lvm", f)).toBeNull();
    expect(diskStorageProblem("lvm", { ...f, name: "2bad" })).toBe("name");
    expect(diskStorageProblem("lvm", { ...f, devices: [] })).toBe("device");
    expect(
      diskStorageProblem("directory", {
        ...f,
        devices: ["/dev/sdb", "/dev/sdc"],
      }),
    ).toBe("oneDevice");
    expect(diskStorageProblem("zfs", { ...f, raidlevel: "mirror" })).toBe(
      "tooFew",
    );
    expect(
      diskStorageProblem("zfs", {
        ...f,
        raidlevel: "raid10",
        devices: ["a", "b", "c", "d", "e"],
      }),
    ).toBe("even");
    expect(diskStorageProblem("zfs", { ...f, ashift: "20" })).toBe("ashift");
  });

  it("builds create and remove params", () => {
    const f = {
      ...emptyDiskStorageForm(),
      name: "tank",
      devices: ["/dev/sdb", "/dev/sdc"],
      raidlevel: "mirror" as const,
      compression: "lz4" as const,
    };
    expect(diskStorageParams("zfs", f)).toEqual({
      name: "tank",
      add_storage: true,
      devices: "/dev/sdb,/dev/sdc",
      raidlevel: "mirror",
      compression: "lz4",
      ashift: 12,
    });
    expect(
      diskStorageParams("directory", {
        ...f,
        devices: ["/dev/sdb"],
        filesystem: "xfs",
      }),
    ).toEqual({
      name: "tank",
      add_storage: true,
      device: "/dev/sdb",
      filesystem: "xfs",
    });
    expect(
      removeParams(
        "lvmthin",
        { cleanupConfig: true, cleanupDisks: false },
        "pve",
      ),
    ).toEqual({
      "cleanup-config": true,
      "cleanup-disks": false,
      "volume-group": "pve",
    });
    expect(
      removeParams("zfs", { cleanupConfig: false, cleanupDisks: true }),
    ).not.toHaveProperty("volume-group");
  });
});

describe("ACME", () => {
  it("reads old and new style domains", () => {
    expect(
      parseAcmeConfig({
        acme: "account=default,domains=a.example.com;b.example.com",
        acmedomain0: "domain=c.example.com,plugin=cf,alias=_acme.example.org",
        acmedomain1: "d.example.com,plugin=standalone",
        digest: "x",
      }),
    ).toEqual({
      account: "default",
      domains: [
        { domain: "a.example.com", plugin: "", alias: "" },
        { domain: "b.example.com", plugin: "", alias: "" },
        { domain: "c.example.com", plugin: "cf", alias: "_acme.example.org" },
        { domain: "d.example.com", plugin: "", alias: "" },
      ],
    });
    expect(parseAcmeConfig({})).toEqual({ account: "", domains: [] });
  });

  it("writes domains into acmedomainN and deletes the leftovers", () => {
    const params = acmeConfigParams(
      {
        account: "le",
        domains: [{ domain: " pve.example.com ", plugin: "", alias: "" }],
      },
      { acmedomain0: "domain=old", acmedomain1: "domain=gone" },
    );
    expect(params).toEqual({
      acme: "account=le",
      acmedomain0: "domain=pve.example.com",
      delete: "acmedomain1",
    });
  });

  it("checks domains", () => {
    const one = (domain: string, plugin = "") => ({
      account: "le",
      domains: [{ domain, plugin, alias: "" }],
    });
    expect(acmeConfigProblem(one("pve.example.com"))).toBeNull();
    expect(acmeConfigProblem(one("localhost"))).toBe("domain");
    expect(acmeConfigProblem(one("*.example.com"))).toBe("wildcard");
    expect(acmeConfigProblem(one("*.example.com", "cf"))).toBeNull();
    expect(acmeConfigProblem({ account: "le", domains: [] })).toBe("noDomain");
  });

  it("encodes DNS plugin settings as PVE stores them", () => {
    const data = encodePluginData({ CF_Token: " abc ", CF_Account_ID: "" });
    expect(atob(data)).toBe("CF_Token=abc");
    expect(pluginIdProblem("cloudflare")).toBeNull();
    expect(pluginIdProblem("9bad")).toBe("pluginId");
  });

  it("checks and builds an account registration", () => {
    const form = {
      name: "default",
      email: "admin@example.com",
      directory: "https://acme-v02.api.letsencrypt.org/directory",
      acceptTos: false,
      eabKid: "",
      eabHmac: "",
    };
    expect(accountProblem(form, "https://tos")).toBe("tos");
    expect(
      accountProblem({ ...form, acceptTos: true }, "https://tos"),
    ).toBeNull();
    expect(accountProblem({ ...form, eabKid: "k" }, null)).toBe("eab");
    expect(accountParams({ ...form, acceptTos: true }, "https://tos")).toEqual({
      name: "default",
      contact: "admin@example.com",
      directory: form.directory,
      tos_url: "https://tos",
      "eab-kid": undefined,
      "eab-hmac-key": undefined,
    });
  });
});
