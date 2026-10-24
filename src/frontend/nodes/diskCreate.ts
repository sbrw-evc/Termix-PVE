import type { PveParams } from "../api";
import type { DiskStorageKind } from "./DiskStorage";

/** One entry of GET /nodes/{node}/disks/list, as the create dialogs need it. */
export interface ListedDisk {
  devpath: string;
  model?: string;
  size?: number;
  type?: string;
  used?: string;
  gpt?: number;
}

/** Disks with nothing on them: no partitions, filesystem, LVM, ZFS or mount. */
export function unusedDisks(disks: ListedDisk[] | null): ListedDisk[] {
  return (disks ?? []).filter((d) => !d.used || d.used === "unused");
}

export type ZfsRaid =
  "single" | "mirror" | "raid10" | "raidz" | "raidz2" | "raidz3";

export const ZFS_RAIDS: ZfsRaid[] = [
  "single",
  "mirror",
  "raid10",
  "raidz",
  "raidz2",
  "raidz3",
];

/** The fewest disks each ZFS layout takes, as Proxmox checks them. */
export const ZFS_MIN_DISKS: Record<ZfsRaid, number> = {
  single: 1,
  mirror: 2,
  raid10: 4,
  raidz: 3,
  raidz2: 4,
  raidz3: 5,
};

export const ZFS_COMPRESSION = [
  "on",
  "off",
  "lz4",
  "zstd",
  "gzip",
  "lzjb",
  "zle",
] as const;

export interface DiskStorageForm {
  name: string;
  /** One disk for LVM, LVM-Thin and directories; one or more for ZFS. */
  devices: string[];
  addStorage: boolean;
  filesystem: "ext4" | "xfs";
  raidlevel: ZfsRaid;
  compression: (typeof ZFS_COMPRESSION)[number];
  ashift: string;
}

export function emptyDiskStorageForm(): DiskStorageForm {
  return {
    name: "",
    devices: [],
    addStorage: true,
    filesystem: "ext4",
    raidlevel: "single",
    compression: "on",
    ashift: "12",
  };
}

/** A PVE storage id: a letter, then letters, digits, "-", "_" or ".". */
const STORAGE_ID = /^[A-Za-z][A-Za-z0-9\-_.]*[A-Za-z0-9]$/;

/** A locale key for what is wrong, or null. */
export function diskStorageProblem(
  kind: DiskStorageKind,
  f: DiskStorageForm,
): string | null {
  if (!STORAGE_ID.test(f.name)) return "name";
  if (!f.devices.length) return "device";
  if (kind !== "zfs") return f.devices.length === 1 ? null : "oneDevice";
  if (f.devices.length < ZFS_MIN_DISKS[f.raidlevel]) return "tooFew";
  if (f.raidlevel === "raid10" && f.devices.length % 2) return "even";
  const ashift = Number(f.ashift);
  if (!Number.isInteger(ashift) || ashift < 9 || ashift > 16) return "ashift";
  return null;
}

export function diskStorageParams(
  kind: DiskStorageKind,
  f: DiskStorageForm,
): PveParams {
  const base = { name: f.name, add_storage: f.addStorage };
  if (kind === "zfs") {
    return {
      ...base,
      devices: f.devices.join(","),
      raidlevel: f.raidlevel,
      compression: f.compression,
      ashift: Number(f.ashift),
    };
  }
  if (kind === "directory") {
    return { ...base, device: f.devices[0], filesystem: f.filesystem };
  }
  return { ...base, device: f.devices[0] };
}

export interface RemoveForm {
  cleanupConfig: boolean;
  cleanupDisks: boolean;
}

/** DELETE params; an LVM-Thin pool also names its volume group. */
export function removeParams(
  kind: DiskStorageKind,
  f: RemoveForm,
  volumeGroup?: string,
): PveParams {
  return {
    "cleanup-config": f.cleanupConfig,
    "cleanup-disks": f.cleanupDisks,
    ...(kind === "lvmthin" ? { "volume-group": volumeGroup } : {}),
  };
}
