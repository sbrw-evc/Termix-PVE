import { describe, expect, it } from "vitest";
import {
  cephInitParams,
  cephInitProblem,
  cephSetupState,
  flattenOsds,
  osdParams,
  osdProblem,
} from "../../src/frontend/nodes/ceph";
import {
  createClusterParams,
  createClusterProblem,
  joinClusterParams,
  joinInformation,
  parseJoinInformation,
} from "../../src/frontend/datacenter/cluster";
import {
  proxmoxBaseUrl,
  usesDirectApi,
  webConsoleUrl,
} from "../../src/frontend/proxmoxWeb";
import { SUBSCRIPTION_KEY } from "../../src/frontend/nodes/NodeExtras";

describe("ceph setup", () => {
  it("tells install from init from ready", () => {
    expect(cephSetupState(null)).toBe("ready");
    expect(cephSetupState("binary not installed: /usr/bin/ceph-mon")).toBe(
      "install",
    );
    expect(cephSetupState("pveceph configuration not initialized")).toBe(
      "init",
    );
    expect(cephSetupState("permission denied")).toBe("error");
  });

  it("flattens the OSD tree with hosts", () => {
    const osds = flattenOsds({
      root: {
        id: -1,
        name: "default",
        type: "root",
        children: [
          {
            id: -3,
            name: "pve1",
            type: "host",
            children: [
              {
                id: 1,
                name: "osd.1",
                type: "osd",
                status: "down",
                in: 0,
                device_class: "ssd",
              },
              {
                id: 0,
                name: "osd.0",
                type: "osd",
                status: "up",
                in: 1,
                device_class: "hdd",
              },
            ],
          },
        ],
      },
    });
    expect(osds.map((o) => [o.name, o.host, o.up, o.in])).toEqual([
      ["osd.0", "pve1", true, true],
      ["osd.1", "pve1", false, false],
    ]);
    expect(flattenOsds(null)).toEqual([]);
  });

  it("checks and builds init and OSD params", () => {
    const init = {
      network: "10.10.10.0/24",
      clusterNetwork: "",
      size: "3",
      minSize: "2",
    };
    expect(cephInitProblem(init)).toBeNull();
    expect(cephInitProblem({ ...init, network: "10.10.10.1" })).toBe("network");
    expect(cephInitProblem({ ...init, minSize: "4" })).toBe("minSize");
    expect(cephInitParams(init)).toEqual({
      network: "10.10.10.0/24",
      "cluster-network": undefined,
      size: 3,
      min_size: 2,
    });
    const osd = {
      dev: "/dev/sdb",
      dbDev: "",
      dbSize: "",
      walDev: "",
      walSize: "",
      encrypted: false,
      deviceClass: "",
    };
    expect(osdProblem(osd)).toBeNull();
    expect(osdProblem({ ...osd, dbDev: "/dev/sdb" })).toBe("sameDisk");
    expect(osdProblem({ ...osd, dbDev: "/dev/nvme0n1", dbSize: "-1" })).toBe(
      "sizeGiB",
    );
    expect(
      osdParams({
        ...osd,
        dbDev: "/dev/nvme0n1",
        dbSize: "30",
        encrypted: true,
      }),
    ).toEqual({
      dev: "/dev/sdb",
      db_dev: "/dev/nvme0n1",
      db_dev_size: 30,
      wal_dev: undefined,
      wal_dev_size: undefined,
      encrypted: true,
      "crush-device-class": undefined,
    });
  });
});

describe("clusters", () => {
  it("reads back the join information Proxmox copies", () => {
    const info = joinInformation({
      preferred_node: "pve1",
      nodelist: [
        {
          name: "pve1",
          pve_addr: "10.0.0.1",
          pve_fp: "AA:BB",
          ring0_addr: "10.0.0.1",
        },
      ],
      totem: {},
    })!;
    expect(parseJoinInformation(info)).toEqual({
      ipAddress: "10.0.0.1",
      fingerprint: "AA:BB",
      peerLinks: { "0": "10.0.0.1" },
    });
    expect(parseJoinInformation("not base64 json")).toBeNull();
    expect(
      joinClusterParams({ info, password: "pw", link0: " 10.0.0.2 " }),
    ).toEqual({
      hostname: "10.0.0.1",
      fingerprint: "AA:BB",
      password: "pw",
      link0: "10.0.0.2",
    });
  });

  it("checks a new cluster's name and links", () => {
    expect(
      createClusterProblem({
        name: "pve-cluster",
        link0: "10.0.0.1",
        link1: "",
      }),
    ).toBeNull();
    expect(
      createClusterProblem({
        name: "a name with spaces",
        link0: "",
        link1: "",
      }),
    ).toBe("name");
    expect(createClusterProblem({ name: "c1", link0: "x/y", link1: "" })).toBe(
      "link",
    );
    expect(
      createClusterParams({ name: " c1 ", link0: "10.0.0.1", link1: "" }),
    ).toEqual({
      clustername: "c1",
      link0: "10.0.0.1",
      link1: undefined,
    });
  });
});

describe("Proxmox web consoles and subscriptions", () => {
  const host = {
    ip: "192.168.0.200",
    pluginSettings: { pve: { pveTransport: "direct", pveApiPort: 8443 } },
  };

  it("builds Proxmox's own console URLs for direct API hosts", () => {
    expect(usesDirectApi(host)).toBe(true);
    expect(
      usesDirectApi({ pluginSettings: { pve: { pveTransport: "tunnel" } } }),
    ).toBe(false);
    const base = proxmoxBaseUrl(host)!;
    expect(base).toBe("https://192.168.0.200:8443");
    expect(
      webConsoleUrl(base, {
        kind: "qemu",
        node: "pve",
        vmid: 101,
        name: "win",
      }),
    ).toBe(
      "https://192.168.0.200:8443/?console=kvm&novnc=1&vmid=101&vmname=win&node=pve&resize=off&cmd=",
    );
    expect(
      webConsoleUrl(base, { kind: "shell", node: "pve", cmd: "ceph_install" }),
    ).toContain("console=shell&xtermjs=1&node=pve&resize=off&cmd=ceph_install");
    expect(proxmoxBaseUrl({ ip: "fe80::1", pluginSettings: {} })).toBe(
      "https://[fe80::1]:8006",
    );
  });

  it("knows a subscription key", () => {
    expect(SUBSCRIPTION_KEY.test("pve1c-0123456789")).toBe(true);
    expect(SUBSCRIPTION_KEY.test("pve4p-arm-abcdef0123")).toBe(true);
    expect(SUBSCRIPTION_KEY.test("pve3x-0123456789")).toBe(false);
  });
});
