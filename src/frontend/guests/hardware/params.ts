import type { GuestType, PveParams } from "../../api";
import { formatProps, type PropString, type QemuBus } from "../config";

const CIDR4_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const CIDR6_RE = /^[0-9a-fA-F:]+\/\d{1,3}$/;
const BRIDGE_RE = /^[A-Za-z0-9_.-]{1,15}$/;
const IFACE_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,14}$/;
const MOUNT_RE = /^\/[^\s,=]*$/;

const int = (n: number, min = 1) => Number.isInteger(n) && n >= min;

// Processor and memory

export interface QemuCpuMemForm {
  sockets: number;
  cores: number;
  cpu: string;
  memoryMiB: number;
  /** Minimum memory for the balloon; 0 turns ballooning off. */
  balloonMiB: number;
}

export function qemuCpuMemProblem(f: QemuCpuMemForm): string | null {
  if (!int(f.sockets) || !int(f.cores)) return "cpu";
  if (!int(f.memoryMiB, 16)) return "memory";
  if (!int(f.balloonMiB, 0) || f.balloonMiB > f.memoryMiB) return "balloon";
  return null;
}

export function qemuCpuMemChanges(f: QemuCpuMemForm) {
  return {
    sockets: f.sockets,
    cores: f.cores,
    cpu: f.cpu,
    memory: f.memoryMiB,
    // Equal to memory means "no ballooning floor"; PVE drops the key then.
    balloon: f.balloonMiB === f.memoryMiB ? null : f.balloonMiB,
  };
}

export interface LxcCpuMemForm {
  /** null for every core of the node, which is what an unset cores means. */
  cores: number | null;
  /** 0 is no limit. */
  cpulimit: number;
  memoryMiB: number;
  swapMiB: number;
}

export function lxcCpuMemProblem(f: LxcCpuMemForm): string | null {
  if (f.cores !== null && !int(f.cores)) return "cpu";
  if (!(f.cpulimit >= 0 && f.cpulimit <= 8192)) return "cpulimit";
  if (!int(f.memoryMiB, 16)) return "memory";
  if (!int(f.swapMiB, 0)) return "swap";
  return null;
}

export function lxcCpuMemChanges(f: LxcCpuMemForm) {
  return {
    cores: f.cores,
    cpulimit: f.cpulimit > 0 ? f.cpulimit : null,
    memory: f.memoryMiB,
    swap: f.swapMiB,
  };
}

// Disks

export interface QemuDiskForm {
  bus: QemuBus;
  storage: string;
  sizeGiB: number;
  iothread: boolean;
  discard: boolean;
  ssd: boolean;
}

/** The value of a new VM disk. A new volume is "<storage>:<size in GiB>". */
export function qemuDiskValue(f: QemuDiskForm): string {
  return formatProps({
    head: `${f.storage}:${f.sizeGiB}`,
    values: {
      // iothread only works on virtio and scsi with virtio-scsi-single.
      iothread:
        f.iothread && (f.bus === "virtio" || f.bus === "scsi") ? "1" : "",
      discard: f.discard ? "on" : "",
      ssd: f.ssd && f.bus !== "virtio" ? "1" : "",
    },
  });
}

export interface LxcMountForm {
  storage: string;
  sizeGiB: number;
  path: string;
  backup: boolean;
}

export function lxcMountProblem(f: LxcMountForm): string | null {
  if (!f.storage) return "storage";
  if (!int(f.sizeGiB)) return "size";
  if (!MOUNT_RE.test(f.path) || f.path === "/") return "path";
  return null;
}

export function lxcMountValue(f: LxcMountForm): string {
  return formatProps({
    head: `${f.storage}:${f.sizeGiB}`,
    values: { mp: f.path, backup: f.backup ? "1" : "" },
  });
}

/** PVE's resize takes "+<n>G" to grow by n GiB. Disks can't shrink. */
export function resizeParams(disk: string, growGiB: number): PveParams {
  return { disk, size: `+${growGiB}G` };
}

export function moveParams(
  type: GuestType,
  disk: string,
  storage: string,
  deleteSource: boolean,
): PveParams {
  return type === "qemu"
    ? { disk, storage, delete: deleteSource }
    : { volume: disk, storage, delete: deleteSource };
}

// Network adapters

export interface QemuNicForm {
  model: string;
  /** Kept on edit so the guest keeps its address; empty lets PVE pick one. */
  mac: string;
  bridge: string;
  tag: string;
  firewall: boolean;
  /** MB/s, empty for no limit. */
  rate: string;
}

export function qemuNicProblem(f: QemuNicForm): string | null {
  if (!BRIDGE_RE.test(f.bridge)) return "bridge";
  if (f.tag && !(int(Number(f.tag)) && Number(f.tag) <= 4094)) return "tag";
  if (f.rate && !(Number(f.rate) > 0)) return "rate";
  return null;
}

/** keep without the keys the form owns, so unknown options survive an edit. */
function omit(
  keep: PropString["values"],
  keys: string[],
): PropString["values"] {
  return Object.fromEntries(
    Object.entries(keep).filter(([k]) => !keys.includes(k)),
  );
}

const QEMU_NIC_KEYS = [
  "virtio",
  "e1000",
  "e1000e",
  "vmxnet3",
  "rtl8139",
  "bridge",
  "tag",
  "firewall",
  "rate",
];

export function qemuNicValue(
  f: QemuNicForm,
  keep: PropString["values"] = {},
): string {
  // The model comes first, with the MAC when there is one: "virtio=BC:24:...".
  const model = f.mac ? `${f.model}=${f.mac}` : f.model;
  const rest = formatProps({
    values: {
      bridge: f.bridge,
      tag: f.tag,
      firewall: f.firewall ? "1" : "",
      rate: f.rate,
      ...omit(keep, QEMU_NIC_KEYS),
    },
  });
  return rest ? `${model},${rest}` : model;
}

export interface LxcNicForm {
  name: string;
  hwaddr: string;
  bridge: string;
  ip4: "dhcp" | "static" | "none";
  cidr4: string;
  gw4: string;
  ip6: "none" | "dhcp" | "auto" | "static";
  cidr6: string;
  gw6: string;
  tag: string;
  firewall: boolean;
}

export function lxcNicProblem(f: LxcNicForm): string | null {
  if (!IFACE_RE.test(f.name)) return "name";
  if (!BRIDGE_RE.test(f.bridge)) return "bridge";
  if (
    f.ip4 === "static" &&
    (!CIDR4_RE.test(f.cidr4) || (f.gw4 && !IPV4_RE.test(f.gw4)))
  ) {
    return "ip4";
  }
  if (f.ip6 === "static" && !CIDR6_RE.test(f.cidr6)) return "ip6";
  if (f.tag && !(int(Number(f.tag)) && Number(f.tag) <= 4094)) return "tag";
  return null;
}

const LXC_NIC_KEYS = [
  "name",
  "hwaddr",
  "bridge",
  "ip",
  "gw",
  "ip6",
  "gw6",
  "tag",
  "firewall",
];

export function lxcNicValue(
  f: LxcNicForm,
  keep: PropString["values"] = {},
): string {
  return formatProps({
    values: {
      name: f.name,
      bridge: f.bridge,
      hwaddr: f.hwaddr,
      ip: f.ip4 === "dhcp" ? "dhcp" : f.ip4 === "static" ? f.cidr4 : "",
      gw: f.ip4 === "static" ? f.gw4 : "",
      ip6: f.ip6 === "static" ? f.cidr6 : f.ip6 === "none" ? "" : f.ip6,
      gw6: f.ip6 === "static" ? f.gw6 : "",
      tag: f.tag,
      firewall: f.firewall ? "1" : "",
      ...omit(keep, LXC_NIC_KEYS),
    },
  });
}

/** Reads an LXC adapter back into the form. */
export function lxcNicForm(values: PropString["values"]): LxcNicForm {
  const ip = values.ip ?? "";
  const ip6 = values.ip6 ?? "";
  return {
    name: values.name ?? "eth0",
    hwaddr: values.hwaddr ?? "",
    bridge: values.bridge ?? "",
    ip4: ip === "dhcp" ? "dhcp" : ip ? "static" : "none",
    cidr4: ip && ip !== "dhcp" ? ip : "",
    gw4: values.gw ?? "",
    ip6: ip6 === "dhcp" || ip6 === "auto" ? ip6 : ip6 ? "static" : "none",
    cidr6: ip6 && ip6 !== "dhcp" && ip6 !== "auto" ? ip6 : "",
    gw6: values.gw6 ?? "",
    tag: values.tag ?? "",
    firewall: values.firewall === "1",
  };
}
