import { describe, expect, it } from "vitest";
import {
  cloudInitDrive,
  formatProps,
  lxcVolumes,
  nextFreeKey,
  nextQemuDiskKey,
  nics,
  parseProps,
  pendingKeys,
  qemuCdDrives,
  qemuDisks,
  qemuNicModel,
  sizeToGiB,
  unusedVolumes,
} from "../../src/frontend/guests/config";

const vm = {
  digest: "abc",
  scsi0: "local-lvm:vm-100-disk-0,iothread=1,size=32G",
  scsi1: "local-lvm:vm-100-disk-1,size=8G",
  ide2: "local:iso/debian.iso,media=cdrom",
  ide0: "local-lvm:vm-100-cloudinit,media=cdrom",
  sata0: "none,media=cdrom",
  efidisk0: "local-lvm:vm-100-disk-2,efitype=4m,size=4M",
  unused0: "local-lvm:vm-100-disk-3",
  net0: "virtio=BC:24:11:00:00:01,bridge=vmbr0,firewall=1",
  net1: "e1000=BC:24:11:00:00:02,bridge=vmbr1,tag=10",
};

const ct = {
  rootfs: "local-lvm:vm-400-disk-0,size=16G",
  mp1: "local-lvm:vm-400-disk-2,mp=/srv,size=4G",
  mp0: "local-lvm:vm-400-disk-1,mp=/data,backup=1,size=2G",
  net0: "name=eth0,bridge=vmbr0,hwaddr=BC:24:11:69:EE:4F,ip=192.168.0.50/24,gw=192.168.0.1,type=veth",
};

describe("property strings", () => {
  it("reads the head and pairs", () => {
    expect(parseProps(vm.scsi0)).toEqual({
      head: "local-lvm:vm-100-disk-0",
      values: { iothread: "1", size: "32G" },
    });
    expect(parseProps("virtio=BC:24,bridge=vmbr0")).toEqual({
      values: { virtio: "BC:24", bridge: "vmbr0" },
    });
    expect(parseProps(undefined)).toEqual({ values: {} });
  });

  it("writes them back, dropping empty values", () => {
    expect(
      formatProps({
        head: "local-lvm:5",
        values: { iothread: "1", discard: "" },
      }),
    ).toBe("local-lvm:5,iothread=1");
    expect(formatProps({ values: { name: "eth0", bridge: "vmbr0" } })).toBe(
      "name=eth0,bridge=vmbr0",
    );
  });

  it("reads sizes", () => {
    expect(sizeToGiB("32G")).toBe(32);
    expect(sizeToGiB("512M")).toBe(0.5);
    expect(sizeToGiB("1T")).toBe(1024);
    expect(sizeToGiB("x")).toBeNull();
  });
});

describe("devices", () => {
  it("lists VM disks without CDs and the cloud-init drive", () => {
    expect(qemuDisks(vm).map((d) => d.key)).toEqual([
      "efidisk0",
      "scsi0",
      "scsi1",
    ]);
    expect(qemuDisks(vm)[1]).toMatchObject({
      volume: "local-lvm:vm-100-disk-0",
      size: "32G",
    });
    expect(qemuCdDrives(vm)).toEqual([
      { key: "ide2", media: "local:iso/debian.iso" },
      { key: "sata0", media: "none" },
    ]);
    expect(cloudInitDrive(vm)).toBe("ide0");
    expect(cloudInitDrive(ct)).toBeNull();
  });

  it("lists container volumes with the root first", () => {
    expect(lxcVolumes(ct).map((v) => [v.key, v.mountPath])).toEqual([
      ["rootfs", undefined],
      ["mp0", "/data"],
      ["mp1", "/srv"],
    ]);
  });

  it("lists unused volumes and adapters", () => {
    expect(unusedVolumes(vm).map((v) => v.volume)).toEqual([
      "local-lvm:vm-100-disk-3",
    ]);
    expect(nics(vm).map((n) => qemuNicModel(n))).toEqual([
      { model: "virtio", mac: "BC:24:11:00:00:01" },
      { model: "e1000", mac: "BC:24:11:00:00:02" },
    ]);
    expect(nics(ct)[0].props.values).toMatchObject({
      name: "eth0",
      ip: "192.168.0.50/24",
    });
  });

  it("finds the next free slot", () => {
    expect(nextQemuDiskKey(vm, "scsi")).toBe("scsi2");
    expect(nextQemuDiskKey(vm, "virtio")).toBe("virtio0");
    expect(nextFreeKey(ct, "mp", 255)).toBe("mp2");
    expect(nextFreeKey(vm, "net", 31)).toBe("net2");
    expect(nextFreeKey({ net0: "x" }, "net", 0)).toBeNull();
  });

  it("reads pending changes", () => {
    expect([
      ...pendingKeys([
        { key: "memory", pending: 4096 },
        { key: "net1", delete: 1 },
        { key: "cores" },
      ]),
    ]).toEqual(["memory", "net1"]);
  });
});
