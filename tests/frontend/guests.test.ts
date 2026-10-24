import { describe, expect, it } from "vitest";
import { availableActions } from "../../src/frontend/guests/actions";
import {
  cloneParams,
  ctCreateParams,
  ctFormProblem,
  deleteParams,
  isValidHostname,
  migrateParams,
  vmCreateParams,
  vmFormProblem,
  type CtForm,
  type VmForm,
} from "../../src/frontend/guests/params";
import { volumeName, storageHolds } from "../../src/frontend/guests/lookups";

const ct: CtForm = {
  vmid: 401,
  hostname: "web-01",
  template: "local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst",
  password: "",
  sshKeys: "ssh-ed25519 AAAA test",
  unprivileged: true,
  storage: "local-lvm",
  diskGiB: 8,
  cores: 1,
  memoryMiB: 512,
  swapMiB: 512,
  net: { bridge: "vmbr0", mode: "dhcp", cidr: "", gateway: "" },
  start: true,
};

const vm: VmForm = {
  vmid: 500,
  name: "vm-01",
  ostype: "l26",
  iso: "local:iso/debian-13.iso",
  storage: "local-lvm",
  diskGiB: 32,
  sockets: 1,
  cores: 2,
  memoryMiB: 2048,
  bridge: "vmbr0",
  start: false,
};

describe("availableActions", () => {
  it("follows the guest's state", () => {
    expect(availableActions({ type: "lxc", status: "stopped" })).toEqual([
      "start",
    ]);
    expect(availableActions({ type: "lxc", status: "running" })).toEqual([
      "shutdown",
      "reboot",
      "stop",
    ]);
    expect(availableActions({ type: "qemu", status: "running" })).toEqual([
      "shutdown",
      "reboot",
      "suspend",
      "stop",
      "reset",
    ]);
    expect(
      availableActions({
        type: "qemu",
        status: "running",
        qmpstatus: "paused",
      }),
    ).toEqual(["resume", "stop"]);
    expect(
      availableActions({ type: "qemu", status: "stopped", template: true }),
    ).toEqual([]);
  });
});

describe("container create", () => {
  it("builds the params Proxmox takes", () => {
    expect(ctCreateParams(ct)).toEqual({
      vmid: 401,
      hostname: "web-01",
      ostemplate: ct.template,
      password: undefined,
      "ssh-public-keys": "ssh-ed25519 AAAA test",
      unprivileged: true,
      features: "nesting=1",
      rootfs: "local-lvm:8",
      cores: 1,
      memory: 512,
      swap: 512,
      net0: "name=eth0,bridge=vmbr0,ip=dhcp",
      start: true,
    });
    expect(
      ctCreateParams({
        ...ct,
        unprivileged: false,
        net: {
          bridge: "vmbr1",
          mode: "static",
          cidr: "192.168.0.60/24",
          gateway: "192.168.0.1",
        },
      }),
    ).toMatchObject({
      features: undefined,
      net0: "name=eth0,bridge=vmbr1,ip=192.168.0.60/24,gw=192.168.0.1",
    });
  });

  it("says what is missing", () => {
    expect(ctFormProblem(ct)).toBeNull();
    expect(ctFormProblem({ ...ct, vmid: 99 })).toBe("vmid");
    expect(ctFormProblem({ ...ct, hostname: "bad_name" })).toBe("hostname");
    expect(ctFormProblem({ ...ct, template: "" })).toBe("template");
    expect(ctFormProblem({ ...ct, diskGiB: NaN })).toBe("disk");
    expect(ctFormProblem({ ...ct, memoryMiB: 8 })).toBe("memory");
    expect(
      ctFormProblem({
        ...ct,
        net: { ...ct.net, mode: "static", cidr: "1.2.3.4" },
      }),
    ).toBe("network");
    expect(ctFormProblem({ ...ct, sshKeys: "" })).toBe("login");
    expect(ctFormProblem({ ...ct, password: "abc" })).toBe("password");
  });
});

describe("vm create", () => {
  it("builds the params Proxmox takes", () => {
    expect(vmCreateParams(vm)).toMatchObject({
      vmid: 500,
      name: "vm-01",
      scsi0: "local-lvm:32,iothread=1",
      ide2: "local:iso/debian-13.iso,media=cdrom",
      net0: "virtio,bridge=vmbr0",
      boot: "order=scsi0;ide2",
    });
    expect(vmCreateParams({ ...vm, iso: "", ostype: "win11" })).toMatchObject({
      ide2: "none,media=cdrom",
      net0: "e1000,bridge=vmbr0",
    });
    expect(vmFormProblem(vm)).toBeNull();
    expect(vmFormProblem({ ...vm, storage: "" })).toBe("storage");
    expect(vmFormProblem({ ...vm, bridge: "" })).toBe("network");
  });
});

describe("other guest params", () => {
  it("clones with the right name field", () => {
    expect(
      cloneParams("qemu", {
        newid: 501,
        name: "copy",
        target: "pve2",
        full: true,
        storage: "fast",
      }),
    ).toEqual({
      newid: 501,
      name: "copy",
      target: "pve2",
      full: true,
      storage: "fast",
    });
    expect(
      cloneParams("lxc", {
        newid: 402,
        name: "copy",
        target: "",
        full: false,
        storage: "fast",
      }),
    ).toEqual({
      newid: 402,
      hostname: "copy",
      target: undefined,
      full: false,
      storage: undefined,
    });
  });

  it("migrates live or with a restart", () => {
    expect(migrateParams("qemu", "pve2", true)).toEqual({
      target: "pve2",
      online: true,
    });
    expect(migrateParams("lxc", "pve2", true)).toEqual({
      target: "pve2",
      restart: true,
    });
  });

  it("deletes with purge flags", () => {
    expect(deleteParams(true, false)).toEqual({
      purge: true,
      "destroy-unreferenced-disks": false,
    });
  });

  it("checks hostnames like Proxmox does", () => {
    expect(isValidHostname("web-01")).toBe(true);
    expect(isValidHostname("web.lan")).toBe(true);
    expect(isValidHostname("-web")).toBe(false);
    expect(isValidHostname("web_01")).toBe(false);
  });
});

describe("lookups", () => {
  it("names volumes and reads storage content", () => {
    expect(volumeName("local:iso/debian-13.iso")).toBe("debian-13.iso");
    expect(volumeName("nfs:vztmpl/sub/alpine.tar.xz")).toBe("alpine.tar.xz");
    expect(
      storageHolds(
        { storage: "local", type: "dir", content: "iso, vztmpl,backup" },
        "vztmpl",
      ),
    ).toBe(true);
    expect(
      storageHolds({ storage: "local", type: "dir", content: "iso" }, "images"),
    ).toBe(false);
  });
});
