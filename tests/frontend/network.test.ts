import { describe, expect, it } from "vitest";
import {
  carriesAddress,
  ifaceForm,
  ifaceParams,
  ifaceProblem,
  type NodeIface,
} from "../../src/frontend/nodes/network";

const vmbr0: NodeIface = {
  iface: "vmbr0",
  type: "bridge",
  autostart: 1,
  address: "192.168.0.200",
  cidr: "192.168.0.200/24",
  gateway: "192.168.0.1",
  bridge_ports: "nic0",
};

describe("node network", () => {
  it("reads an interface into the form", () => {
    expect(ifaceForm(vmbr0)).toMatchObject({
      type: "bridge",
      iface: "vmbr0",
      cidr: "192.168.0.200/24",
      gateway: "192.168.0.1",
      ports: "nic0",
      autostart: true,
      vlanAware: false,
    });
    expect(ifaceForm()).toMatchObject({
      type: "bridge",
      iface: "",
      autostart: true,
    });
  });

  it("builds a new bridge", () => {
    const form = {
      ...ifaceForm(),
      iface: "vmbr1",
      cidr: "10.10.0.1/24",
      vlanAware: true,
    };
    expect(ifaceProblem(form, true)).toBeNull();
    expect(ifaceParams(form, true)).toEqual({
      iface: "vmbr1",
      type: "bridge",
      cidr: "10.10.0.1/24",
      gateway: undefined,
      cidr6: undefined,
      gateway6: undefined,
      autostart: true,
      mtu: undefined,
      comments: undefined,
      bridge_ports: undefined,
      bridge_vlan_aware: true,
    });
  });

  it("clears emptied fields on update", () => {
    const params = ifaceParams(
      { ...ifaceForm(vmbr0), comments: "", gateway: "" },
      false,
    );
    expect(params).toMatchObject({
      type: "bridge",
      cidr: "192.168.0.200/24",
      bridge_ports: "nic0",
    });
    expect(params.delete).toBe(
      "gateway,cidr6,gateway6,mtu,comments,bridge_vlan_aware",
    );
    expect(params.iface).toBeUndefined();
  });

  // PVE writes bridge-vlan-aware yes whenever the param is present, even as 0.
  it("never sends VLAN aware off, only leaves it out or deletes it", () => {
    const off = { ...ifaceForm(), iface: "vmbr99", vlanAware: false };
    expect(ifaceParams(off, true)).not.toHaveProperty(
      "bridge_vlan_aware",
      false,
    );
    expect(ifaceParams(off, true).bridge_vlan_aware).toBeUndefined();

    const aware = { ...vmbr0, bridge_vlan_aware: 1 };
    const update = ifaceParams(
      { ...ifaceForm(aware), vlanAware: false },
      false,
    );
    expect(update.bridge_vlan_aware).toBeUndefined();
    expect(String(update.delete).split(",")).toContain("bridge_vlan_aware");

    const kept = ifaceParams(ifaceForm(aware), false);
    expect(kept.bridge_vlan_aware).toBe(true);
    expect(String(kept.delete ?? "").split(",")).not.toContain(
      "bridge_vlan_aware",
    );
  });

  it("drops the trailing newline PVE keeps on comments", () => {
    const form = ifaceForm({ ...vmbr0, comments: "termix test\n" });
    expect(form.comments).toBe("termix test");
    expect(ifaceParams(form, false).comments).toBe("termix test");
    expect(
      ifaceParams({ ...form, comments: "  \n" }, false).comments,
    ).toBeUndefined();
  });

  it("builds bonds and VLANs", () => {
    const bond = {
      ...ifaceForm(),
      type: "bond" as const,
      iface: "bond0",
      ports: "nic0 nic1",
      bondMode: "802.3ad",
    };
    expect(ifaceProblem(bond, true)).toBeNull();
    expect(ifaceParams(bond, true)).toMatchObject({
      slaves: "nic0 nic1",
      bond_mode: "802.3ad",
    });
    expect(ifaceProblem({ ...bond, ports: "" }, true)).toBe("slaves");

    const vlan = {
      ...ifaceForm(),
      type: "vlan" as const,
      iface: "vlan10",
      vlanDevice: "vmbr0",
    };
    expect(ifaceParams(vlan, true)).toMatchObject({
      "vlan-raw-device": "vmbr0",
      "vlan-id": 10,
    });
    expect(ifaceProblem({ ...vlan, vlanDevice: "" }, true)).toBe("vlanDevice");
    expect(ifaceProblem({ ...vlan, iface: "vmbr0.20" }, true)).toBeNull();
  });

  it("checks names and addresses", () => {
    expect(ifaceProblem({ ...ifaceForm(), iface: "br0" }, true)).toBe(
      "name.bridge",
    );
    expect(
      ifaceProblem({ ...ifaceForm(), iface: "vmbr1", cidr: "10.0.0.1" }, true),
    ).toBe("cidr");
    expect(
      ifaceProblem(
        { ...ifaceForm(), iface: "vmbr1", gateway: "10.0.0.1" },
        true,
      ),
    ).toBe("gateway");
    expect(
      ifaceProblem({ ...ifaceForm(), iface: "vmbr1", mtu: "9" }, true),
    ).toBe("mtu");
  });

  it("knows which interface carries the host's address", () => {
    expect(carriesAddress(vmbr0, "192.168.0.200")).toBe(true);
    expect(carriesAddress(vmbr0, "192.168.0.50")).toBe(false);
  });
});
