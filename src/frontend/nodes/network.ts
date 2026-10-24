import type { PveParams } from "../api";

/** One interface of GET /nodes/{node}/network. */
export interface NodeIface {
  iface: string;
  type: string;
  active?: number;
  autostart?: number;
  method?: string;
  method6?: string;
  cidr?: string;
  address?: string;
  gateway?: string;
  cidr6?: string;
  gateway6?: string;
  bridge_ports?: string;
  bridge_vlan_aware?: number;
  slaves?: string;
  bond_mode?: string;
  "vlan-raw-device"?: string;
  "vlan-id"?: number;
  mtu?: number;
  comments?: string;
}

/** Kinds Termix creates. Physical ports exist already; OVS needs its own package. */
export type IfaceType = "bridge" | "bond" | "vlan";

export interface IfaceForm {
  type: IfaceType;
  iface: string;
  cidr: string;
  gateway: string;
  cidr6: string;
  gateway6: string;
  autostart: boolean;
  /** Bridge ports or bond slaves, space separated. */
  ports: string;
  vlanAware: boolean;
  bondMode: string;
  vlanDevice: string;
  vlanId: string;
  mtu: string;
  comments: string;
}

export const BOND_MODES = [
  "balance-rr",
  "active-backup",
  "balance-xor",
  "broadcast",
  "802.3ad",
  "balance-tlb",
  "balance-alb",
];

export function ifaceForm(iface?: NodeIface): IfaceForm {
  const type = (
    ["bridge", "bond", "vlan"].includes(iface?.type ?? "")
      ? iface!.type
      : "bridge"
  ) as IfaceType;
  return {
    type,
    iface: iface?.iface ?? "",
    cidr: iface?.cidr ?? "",
    gateway: iface?.gateway ?? "",
    cidr6: iface?.cidr6 ?? "",
    gateway6: iface?.gateway6 ?? "",
    autostart: iface ? iface.autostart === 1 : true,
    ports: (type === "bond" ? iface?.slaves : iface?.bridge_ports) ?? "",
    vlanAware: iface?.bridge_vlan_aware === 1,
    bondMode: iface?.bond_mode ?? "active-backup",
    vlanDevice: iface?.["vlan-raw-device"] ?? "",
    vlanId: iface?.["vlan-id"] !== undefined ? String(iface["vlan-id"]) : "",
    mtu: iface?.mtu !== undefined ? String(iface.mtu) : "",
    // PVE keeps the comment block's trailing newline; saving it back adds another.
    comments: iface?.comments?.trim() ?? "",
  };
}

const NAME_RE: Record<IfaceType, RegExp> = {
  bridge: /^vmbr\d{1,4}$/,
  bond: /^bond\d{1,4}$/,
  // vmbr0.10 / eno1.10 style names carry the device and tag themselves.
  vlan: /^([A-Za-z][A-Za-z0-9_-]*\.\d{1,4}|vlan\d{1,4})$/,
};
const CIDR4 = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IP4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const CIDR6 = /^[0-9a-fA-F:]+\/\d{1,3}$/;
const PORTS = /^[A-Za-z0-9_.:-]+( [A-Za-z0-9_.:-]+)*$/;

export function ifaceProblem(f: IfaceForm, creating: boolean): string | null {
  if (creating && !NAME_RE[f.type].test(f.iface)) return `name.${f.type}`;
  if (f.cidr && !CIDR4.test(f.cidr)) return "cidr";
  if (f.gateway && (!f.cidr || !IP4.test(f.gateway))) return "gateway";
  if (f.cidr6 && !CIDR6.test(f.cidr6)) return "cidr6";
  if (f.ports.trim() && !PORTS.test(f.ports.trim())) return "ports";
  if (f.type === "bond" && !f.ports.trim()) return "slaves";
  if (f.type === "vlan" && /^vlan\d/.test(f.iface) && !f.vlanDevice)
    return "vlanDevice";
  if (
    f.mtu &&
    !(
      Number.isInteger(Number(f.mtu)) &&
      Number(f.mtu) >= 1280 &&
      Number(f.mtu) <= 65520
    )
  ) {
    return "mtu";
  }
  return null;
}

/**
 * Params for create (POST) and update (PUT, which needs the type again).
 * On update, empty fields go in `delete` so they are cleared, not kept.
 */
export function ifaceParams(f: IfaceForm, creating: boolean): PveParams {
  const values: Record<string, string | number | boolean | undefined> = {
    type: f.type,
    cidr: f.cidr || undefined,
    gateway: f.gateway || undefined,
    cidr6: f.cidr6 || undefined,
    gateway6: f.gateway6 || undefined,
    autostart: f.autostart,
    mtu: f.mtu ? Number(f.mtu) : undefined,
    comments: f.comments.trim() || undefined,
  };
  if (f.type === "bridge") {
    values.bridge_ports = f.ports.trim() || undefined;
    // PVE turns VLAN aware on whenever the param is present, even as 0, so
    // "off" is leaving it out on create and deleting it on update.
    values.bridge_vlan_aware = f.vlanAware || undefined;
  } else if (f.type === "bond") {
    values.slaves = f.ports.trim();
    values.bond_mode = f.bondMode;
  } else if (/^vlan\d/.test(f.iface)) {
    values["vlan-raw-device"] = f.vlanDevice;
    values["vlan-id"] = f.vlanId ? Number(f.vlanId) : Number(f.iface.slice(4));
  }
  if (creating) return { iface: f.iface, ...values };
  const cleared = [
    "cidr",
    "gateway",
    "cidr6",
    "gateway6",
    "mtu",
    "comments",
  ].filter((k) => values[k] === undefined);
  if (f.type === "bridge" && !values.bridge_ports) cleared.push("bridge_ports");
  if (f.type === "bridge" && !f.vlanAware) cleared.push("bridge_vlan_aware");
  return { ...values, delete: cleared.length ? cleared.join(",") : undefined };
}

/** The interface carrying an address, to warn before it changes. */
export function carriesAddress(iface: NodeIface, address: string): boolean {
  return (
    !!address &&
    (iface.address === address || iface.cidr?.split("/")[0] === address)
  );
}
