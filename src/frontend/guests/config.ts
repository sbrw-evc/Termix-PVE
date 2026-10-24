/**
 * Reading and writing a guest's config. Proxmox keeps devices as property
 * strings, "local-lvm:vm-100-disk-0,size=32G,iothread=1", with the volume or
 * model first and key=value pairs after it.
 */

export type GuestConfig = Record<string, string | number | undefined> & {
  digest?: string;
};

export interface PropString {
  /** The first item when it has no "=": a volume, or a storage like "none". */
  head?: string;
  values: Record<string, string>;
}

export function parseProps(value: string | number | undefined): PropString {
  const result: PropString = { values: {} };
  if (value === undefined) return result;
  String(value)
    .split(",")
    .forEach((item, i) => {
      const eq = item.indexOf("=");
      if (eq === -1) {
        if (i === 0) result.head = item;
        return;
      }
      result.values[item.slice(0, eq)] = item.slice(eq + 1);
    });
  return result;
}

export function formatProps(props: PropString): string {
  const pairs = Object.entries(props.values)
    .filter(([, v]) => v !== "" && v !== undefined)
    .map(([k, v]) => `${k}=${v}`);
  return [...(props.head ? [props.head] : []), ...pairs].join(",");
}

/** "32G", "512M", "1T" in GiB; plain numbers are bytes. */
export function sizeToGiB(size: string | undefined): number | null {
  if (!size) return null;
  const m = /^(\d+(?:\.\d+)?)([KMGT]?)$/i.exec(size.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toUpperCase();
  const factor =
    unit === "T"
      ? 1024
      : unit === "G"
        ? 1
        : unit === "M"
          ? 1 / 1024
          : unit === "K"
            ? 1 / 1024 ** 2
            : 1 / 1024 ** 3;
  return n * factor;
}

const QEMU_DISK_RE = /^(ide|sata|scsi|virtio)(\d+)$/;
const QEMU_BUSES = { ide: 4, sata: 6, scsi: 31, virtio: 16 } as const;
export type QemuBus = keyof typeof QEMU_BUSES;

export interface GuestDisk {
  key: string;
  volume: string;
  size: string | null;
  props: PropString;
  /** LXC mount point path. */
  mountPath?: string;
}

const byIndex = (a: { key: string }, b: { key: string }) => {
  const num = (k: string) => Number(/\d+$/.exec(k)?.[0] ?? -1);
  const prefix = (k: string) => k.replace(/\d+$/, "");
  return prefix(a.key).localeCompare(prefix(b.key)) || num(a.key) - num(b.key);
};

function diskOf(key: string, raw: string | number | undefined): GuestDisk {
  const props = parseProps(raw);
  return {
    key,
    volume: props.head ?? "",
    size: props.values.size ?? null,
    props,
    mountPath: props.values.mp,
  };
}

/** A VM's hard disks, without CD drives and the cloud-init drive. */
export function qemuDisks(config: GuestConfig): GuestDisk[] {
  return Object.keys(config)
    .filter((key) => {
      if (key === "efidisk0" || key === "tpmstate0") return true;
      if (!QEMU_DISK_RE.test(key)) return false;
      const props = parseProps(config[key]);
      return (
        props.values.media !== "cdrom" && !props.head?.includes("cloudinit")
      );
    })
    .map((key) => diskOf(key, config[key]))
    .sort(byIndex);
}

export interface CdDrive {
  key: string;
  /** A volume id, or "none" for an empty drive. */
  media: string;
}

export function qemuCdDrives(config: GuestConfig): CdDrive[] {
  return Object.keys(config)
    .filter(
      (key) =>
        QEMU_DISK_RE.test(key) &&
        parseProps(config[key]).values.media === "cdrom" &&
        // The cloud-init drive is a CD too, but has its own section.
        !parseProps(config[key]).head?.includes("cloudinit"),
    )
    .map((key) => ({ key, media: parseProps(config[key]).head ?? "none" }))
    .sort(byIndex);
}

/** The key of the VM's cloud-init drive, if it has one. */
export function cloudInitDrive(config: GuestConfig): string | null {
  return (
    Object.keys(config).find(
      (key) =>
        QEMU_DISK_RE.test(key) &&
        !!parseProps(config[key]).head?.includes("cloudinit"),
    ) ?? null
  );
}

/** A container's root disk and mount points. */
export function lxcVolumes(config: GuestConfig): GuestDisk[] {
  return Object.keys(config)
    .filter((key) => key === "rootfs" || /^mp\d+$/.test(key))
    .map((key) => diskOf(key, config[key]))
    .sort((a, b) =>
      a.key === "rootfs" ? -1 : b.key === "rootfs" ? 1 : byIndex(a, b),
    );
}

/** Volumes no device uses any more; deleting one frees its space. */
export function unusedVolumes(config: GuestConfig): GuestDisk[] {
  return Object.keys(config)
    .filter((key) => /^unused\d+$/.test(key))
    .map((key) => diskOf(key, config[key]))
    .sort(byIndex);
}

export interface GuestNic {
  key: string;
  props: PropString;
}

export function nics(config: GuestConfig): GuestNic[] {
  return Object.keys(config)
    .filter((key) => /^net\d+$/.test(key))
    .map((key) => ({ key, props: parseProps(config[key]) }))
    .sort(byIndex);
}

const QEMU_NIC_MODELS = ["virtio", "e1000", "e1000e", "vmxnet3", "rtl8139"];

/** A VM adapter's model and MAC: its first pair is "virtio=BC:24:...". */
export function qemuNicModel(nic: GuestNic): { model: string; mac: string } {
  const model = QEMU_NIC_MODELS.find((m) => m in nic.props.values) ?? "virtio";
  return { model, mac: nic.props.values[model] ?? "" };
}

/** The lowest free key with this prefix, like "scsi1", or null when all are taken. */
export function nextFreeKey(
  config: GuestConfig,
  prefix: string,
  max: number,
): string | null {
  for (let i = 0; i <= max; i++) {
    const key = `${prefix}${i}`;
    if (config[key] === undefined) return key;
  }
  return null;
}

export function nextQemuDiskKey(
  config: GuestConfig,
  bus: QemuBus,
): string | null {
  return nextFreeKey(config, bus, QEMU_BUSES[bus] - 1);
}

/** Keys PVE will apply on the next restart, from /pending. */
export function pendingKeys(
  pending: Array<{ key: string; pending?: unknown; delete?: number }>,
): Set<string> {
  return new Set(
    pending
      .filter((p) => p.pending !== undefined || p.delete)
      .map((p) => p.key),
  );
}
