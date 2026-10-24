import type { GuestType, PveParams } from "../api";

// PVE's dns-name format: labels of letters, digits and dashes, dot separated.
const LABEL = "[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const HOSTNAME_RE = new RegExp(`^(?=.{1,253}$)${LABEL}(\\.${LABEL})*$`);
const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

export function isValidHostname(value: string): boolean {
  return HOSTNAME_RE.test(value);
}

export function isValidVmid(value: number): boolean {
  return Number.isInteger(value) && value >= 100 && value <= 999999999;
}

function positiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export interface NetworkForm {
  bridge: string;
  mode: "dhcp" | "static";
  /** 192.168.0.60/24 */
  cidr: string;
  gateway: string;
}

export function isValidNetwork(net: NetworkForm): boolean {
  if (!net.bridge) return false;
  if (net.mode === "dhcp") return true;
  return CIDR_RE.test(net.cidr) && (!net.gateway || IPV4_RE.test(net.gateway));
}

export interface CtForm {
  vmid: number;
  hostname: string;
  template: string;
  password: string;
  sshKeys: string;
  unprivileged: boolean;
  storage: string;
  diskGiB: number;
  cores: number;
  memoryMiB: number;
  swapMiB: number;
  net: NetworkForm;
  start: boolean;
}

/** Why the form can't be sent yet, or null when it can. */
export function ctFormProblem(form: CtForm): string | null {
  if (!isValidVmid(form.vmid)) return "vmid";
  if (!isValidHostname(form.hostname)) return "hostname";
  if (!form.template) return "template";
  if (!form.storage) return "storage";
  if (!positiveInt(form.diskGiB)) return "disk";
  if (!positiveInt(form.cores)) return "cores";
  if (!positiveInt(form.memoryMiB) || form.memoryMiB < 16) return "memory";
  if (!Number.isInteger(form.swapMiB) || form.swapMiB < 0) return "swap";
  if (!isValidNetwork(form.net)) return "network";
  if (!form.password && !form.sshKeys.trim()) return "login";
  if (form.password && form.password.length < 5) return "password";
  return null;
}

export function ctCreateParams(form: CtForm): PveParams {
  const ip =
    form.net.mode === "dhcp"
      ? "ip=dhcp"
      : `ip=${form.net.cidr}${form.net.gateway ? `,gw=${form.net.gateway}` : ""}`;
  return {
    vmid: form.vmid,
    hostname: form.hostname,
    ostemplate: form.template,
    password: form.password || undefined,
    "ssh-public-keys": form.sshKeys.trim() || undefined,
    unprivileged: form.unprivileged,
    // The Proxmox UI turns nesting on for unprivileged containers, which
    // systemd in newer distributions needs.
    features: form.unprivileged ? "nesting=1" : undefined,
    rootfs: `${form.storage}:${form.diskGiB}`,
    cores: form.cores,
    memory: form.memoryMiB,
    swap: form.swapMiB,
    net0: `name=eth0,bridge=${form.net.bridge},${ip}`,
    start: form.start,
  };
}

export type VmOsType = "l26" | "win11" | "win10" | "other";

export interface VmForm {
  vmid: number;
  name: string;
  ostype: VmOsType;
  /** A volume id of an ISO, or "" for no installation media. */
  iso: string;
  storage: string;
  diskGiB: number;
  sockets: number;
  cores: number;
  memoryMiB: number;
  bridge: string;
  start: boolean;
}

export function vmFormProblem(form: VmForm): string | null {
  if (!isValidVmid(form.vmid)) return "vmid";
  if (!isValidHostname(form.name)) return "name";
  if (!form.storage) return "storage";
  if (!positiveInt(form.diskGiB)) return "disk";
  if (!positiveInt(form.sockets)) return "sockets";
  if (!positiveInt(form.cores)) return "cores";
  if (!positiveInt(form.memoryMiB) || form.memoryMiB < 16) return "memory";
  if (!form.bridge) return "network";
  return null;
}

export function vmCreateParams(form: VmForm): PveParams {
  const windows = form.ostype === "win10" || form.ostype === "win11";
  return {
    vmid: form.vmid,
    name: form.name,
    ostype: form.ostype,
    sockets: form.sockets,
    cores: form.cores,
    memory: form.memoryMiB,
    cpu: "host",
    scsihw: "virtio-scsi-single",
    scsi0: `${form.storage}:${form.diskGiB},iothread=1`,
    ide2: form.iso ? `${form.iso},media=cdrom` : "none,media=cdrom",
    boot: "order=scsi0;ide2",
    // Windows has no virtio network driver until the guest tools are in.
    net0: `${windows ? "e1000" : "virtio"},bridge=${form.bridge}`,
    agent: "1",
    start: form.start,
  };
}

export interface CloneForm {
  newid: number;
  name: string;
  target: string;
  full: boolean;
  /** Full clones only; "" keeps the source's storage. */
  storage: string;
}

export function cloneParams(type: GuestType, form: CloneForm): PveParams {
  return {
    newid: form.newid,
    [type === "qemu" ? "name" : "hostname"]: form.name || undefined,
    target: form.target || undefined,
    full: form.full,
    storage: form.full && form.storage ? form.storage : undefined,
  };
}

export function migrateParams(
  type: GuestType,
  target: string,
  running: boolean,
): PveParams {
  // A running VM moves live; a running container restarts on the target.
  return type === "qemu"
    ? { target, online: running }
    : { target, restart: running };
}

export function deleteParams(
  purge: boolean,
  unreferencedDisks: boolean,
): PveParams {
  return {
    purge,
    "destroy-unreferenced-disks": unreferencedDisks,
  };
}
