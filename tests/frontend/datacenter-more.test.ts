import { describe, expect, it } from "vitest";
import {
  composeProps,
  dcOptionsForm,
  dcOptionsParams,
  dcOptionsProblem,
  parseProps,
} from "../../src/frontend/datacenter/options";
import {
  dirEntry,
  entriesByNode,
  pciEntry,
  usbEntry,
  usefulUsb,
} from "../../src/frontend/datacenter/mappings";
import {
  decodeKeyValues,
  encodeKeyValues,
  matcherParams,
  splitList,
} from "../../src/frontend/datacenter/notifications";
import { targetParams } from "../../src/frontend/datacenter/NotificationsPanel";
import { metricParams } from "../../src/frontend/datacenter/MetricsPanel";
import { withPending } from "../../src/frontend/datacenter/SdnPanel";

describe("datacenter options", () => {
  it("reads and writes property strings", () => {
    expect(parseProps("secure,network=10.0.0.0/24", "type")).toEqual({
      type: "secure",
      network: "10.0.0.0/24",
    });
    expect(composeProps({ a: "1", b: "", c: " 2 " })).toBe("a=1,c=2");
    expect(composeProps({ a: "" })).toBeUndefined();
  });

  it("sets what has a value and deletes the rest of its own keys", () => {
    const form = dcOptionsForm({
      keyboard: "en-us",
      mac_prefix: "BC:24:11",
      migration: "type=insecure,network=10.1.0.0/16",
      bwlimit: "migration=100000",
      description: "kept apart",
    });
    expect(form.migrationType).toBe("insecure");
    expect(form.bwMigration).toBe("100000");
    const params = dcOptionsParams({ ...form, keyboard: "", nextLower: "200" });
    expect(params).toMatchObject({
      mac_prefix: "BC:24:11",
      migration: "type=insecure,network=10.1.0.0/16",
      bwlimit: "migration=100000",
      "next-id": "lower=200",
    });
    expect(String(params.delete).split(",")).toContain("keyboard");
    // Notes are saved on their own.
    expect(String(params.delete)).not.toContain("description");
  });

  it("checks the form", () => {
    const ok = dcOptionsForm({});
    expect(dcOptionsProblem(ok)).toBeNull();
    expect(dcOptionsProblem({ ...ok, macPrefix: "ZZ" })).toBe("macPrefix");
    expect(dcOptionsProblem({ ...ok, migrationNetwork: "10.0.0.1" })).toBe(
      "network",
    );
    expect(
      dcOptionsProblem({ ...ok, nextLower: "500", nextUpper: "100" }),
    ).toBe("nextId");
  });
});

describe("resource mappings", () => {
  it("writes one entry per node", () => {
    expect(
      pciEntry("pve1", {
        id: "0000:01:00.0",
        vendor: "0x10de",
        device: "0x1b80",
        subsystem_vendor: "0x1458",
        subsystem_device: "0x3702",
        iommugroup: 14,
      }),
    ).toBe(
      "node=pve1,path=0000:01:00.0,id=10de:1b80,subsystem-id=1458:3702,iommugroup=14",
    );
    expect(
      usbEntry("pve1", { busnum: 1, port: 2, vendid: "046d", prodid: "c52b" }),
    ).toBe("node=pve1,id=046d:c52b");
    expect(dirEntry("pve1", " /mnt/share ")).toBe("node=pve1,path=/mnt/share");
  });

  it("reads which device each node uses", () => {
    expect(
      entriesByNode("pci", [
        "node=a,path=0000:01:00.0,id=10de:1b80",
        "node=b,path=0000:02:00.0",
      ]),
    ).toEqual({ a: "0000:01:00.0", b: "0000:02:00.0" });
    expect(entriesByNode("usb", "node=a,id=046d:c52b")).toEqual({
      a: "046d:c52b",
    });
    expect(entriesByNode("dir", undefined)).toEqual({});
  });

  it("leaves hubs out of the USB picker", () => {
    expect(
      usefulUsb([
        { busnum: 1, port: 0, vendid: "1d6b", prodid: "0002", class: 9 },
        { busnum: 1, port: 2, vendid: "046d", prodid: "c52b", class: 0 },
      ]).map((d) => d.vendid),
    ).toEqual(["046d"]);
  });
});

describe("notifications", () => {
  it("splits lists and encodes webhook headers", () => {
    expect(splitList("a@x, b@x\nc@x")).toEqual(["a@x", "b@x", "c@x"]);
    const encoded = encodeKeyValues(
      "Content-Type: application/json\nX-Token: ab:c",
    );
    expect(encoded[0]).toBe(
      `name=Content-Type,value=${btoa("application/json")}`,
    );
    expect(decodeKeyValues(encoded)).toBe(
      "Content-Type: application/json\nX-Token: ab:c",
    );
  });

  it("sends secrets only when typed", () => {
    const base = {
      type: "smtp",
      name: "mail",
      server: "smtp.example.com",
      mode: "tls",
      port: "",
      username: "u",
      password: "",
      mailto: "a@x, b@x",
      "mailto-user": "",
      "from-address": "",
      author: "",
      token: "",
      url: "",
      method: "",
      header: "",
      body: "",
      secret: "",
      comment: "",
      disable: false,
    };
    const params = targetParams(base, false);
    expect(params.mailto).toEqual(["a@x", "b@x"]);
    expect(params).not.toHaveProperty("password");
    expect(String(params.delete).split(",")).toContain("mailto-user");
    expect(targetParams({ ...base, password: "pw" }, true).password).toBe("pw");
  });

  it("builds matchers with array params", () => {
    const params = matcherParams(
      {
        name: "backups",
        target: "mail-to-root, gotify",
        "match-severity": "error,warning",
        "match-field": "exact:type=vzdump\nregex:hostname=^pve(1,2)$",
        "match-calendar": "",
        mode: "all",
        "invert-match": false,
        comment: "",
        disable: false,
      },
      true,
    );
    expect(params).toMatchObject({
      name: "backups",
      target: ["mail-to-root", "gotify"],
      "match-severity": ["error", "warning"],
      "match-field": ["exact:type=vzdump", "regex:hostname=^pve(1,2)$"],
    });
    expect(params).not.toHaveProperty("match-calendar");
  });
});

describe("metric servers and SDN", () => {
  it("keeps the saved token unless one is typed", () => {
    const values = {
      id: "influx",
      type: "influxdb",
      server: "10.0.0.5",
      port: "8086",
      influxdbproto: "https",
      organization: "org",
      bucket: "pve",
      token: "",
      "api-path-prefix": "",
      "verify-certificate": true,
      proto: "",
      path: "",
      "otel-protocol": "",
      "otel-path": "",
      "otel-compression": "",
      "otel-verify-ssl": true,
      mtu: "",
      timeout: "",
      disable: false,
    };
    expect(metricParams(values, false)).not.toHaveProperty("token");
    expect(metricParams({ ...values, token: "t" }, false).token).toBe("t");
    // The id goes in the path, not the body.
    expect(metricParams(values, true)).not.toHaveProperty("id");
  });

  it("shows pending SDN values over running ones", () => {
    expect(
      withPending({
        zone: "z1",
        type: "vlan",
        bridge: "vmbr0",
        pending: { bridge: "vmbr1" },
      }),
    ).toMatchObject({ zone: "z1", bridge: "vmbr1" });
  });
});
