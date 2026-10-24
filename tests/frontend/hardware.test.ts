import { describe, expect, it } from "vitest";
import { parseProps } from "../../src/frontend/guests/config";
import {
  lxcCpuMemChanges,
  lxcCpuMemProblem,
  lxcMountProblem,
  lxcMountValue,
  lxcNicForm,
  lxcNicProblem,
  lxcNicValue,
  moveParams,
  qemuCpuMemChanges,
  qemuCpuMemProblem,
  qemuDiskValue,
  qemuNicProblem,
  qemuNicValue,
  resizeParams,
} from "../../src/frontend/guests/hardware/params";

describe("processor and memory", () => {
  it("builds VM changes and drops a balloon equal to memory", () => {
    const form = {
      sockets: 1,
      cores: 4,
      cpu: "host",
      memoryMiB: 4096,
      balloonMiB: 4096,
    };
    expect(qemuCpuMemProblem(form)).toBeNull();
    expect(qemuCpuMemChanges(form)).toEqual({
      sockets: 1,
      cores: 4,
      cpu: "host",
      memory: 4096,
      balloon: null,
    });
    expect(qemuCpuMemChanges({ ...form, balloonMiB: 0 }).balloon).toBe(0);
    expect(qemuCpuMemProblem({ ...form, balloonMiB: 8192 })).toBe("balloon");
  });

  it("builds container changes and clears an unlimited cpulimit", () => {
    const form = { cores: 2, cpulimit: 0, memoryMiB: 1024, swapMiB: 0 };
    expect(lxcCpuMemProblem(form)).toBeNull();
    expect(lxcCpuMemChanges(form)).toEqual({
      cores: 2,
      cpulimit: null,
      memory: 1024,
      swap: 0,
    });
    expect(lxcCpuMemProblem({ ...form, memoryMiB: 8 })).toBe("memory");
    // An empty cores field keeps every core: the key is deleted.
    expect(lxcCpuMemProblem({ ...form, cores: null })).toBeNull();
    expect(lxcCpuMemChanges({ ...form, cores: null }).cores).toBeNull();
    expect(lxcCpuMemProblem({ ...form, cores: Number.NaN })).toBe("cpu");
  });
});

describe("disks", () => {
  it("builds a new VM disk", () => {
    const form = {
      bus: "scsi" as const,
      storage: "local-lvm",
      sizeGiB: 20,
      iothread: true,
      discard: true,
      ssd: true,
    };
    expect(qemuDiskValue(form)).toBe(
      "local-lvm:20,iothread=1,discard=on,ssd=1",
    );
    // virtio has no ssd emulation; sata has no iothread.
    expect(qemuDiskValue({ ...form, bus: "virtio" })).toBe(
      "local-lvm:20,iothread=1,discard=on",
    );
    expect(qemuDiskValue({ ...form, bus: "sata", discard: false })).toBe(
      "local-lvm:20,ssd=1",
    );
  });

  it("builds a container mount point", () => {
    const form = {
      storage: "local-lvm",
      sizeGiB: 4,
      path: "/data",
      backup: true,
    };
    expect(lxcMountProblem(form)).toBeNull();
    expect(lxcMountValue(form)).toBe("local-lvm:4,mp=/data,backup=1");
    expect(lxcMountProblem({ ...form, path: "/" })).toBe("path");
    expect(lxcMountProblem({ ...form, path: "data" })).toBe("path");
  });

  it("grows and moves disks", () => {
    expect(resizeParams("scsi0", 10)).toEqual({ disk: "scsi0", size: "+10G" });
    expect(moveParams("qemu", "scsi0", "fast", true)).toEqual({
      disk: "scsi0",
      storage: "fast",
      delete: true,
    });
    expect(moveParams("lxc", "mp0", "fast", false)).toEqual({
      volume: "mp0",
      storage: "fast",
      delete: false,
    });
  });
});

describe("network adapters", () => {
  it("builds a VM adapter, keeping its MAC and other options", () => {
    const keep = parseProps(
      "virtio=BC:24:11:00:00:01,bridge=vmbr0,queues=4,link_down=1",
    ).values;
    expect(
      qemuNicValue(
        {
          model: "virtio",
          mac: "BC:24:11:00:00:01",
          bridge: "vmbr1",
          tag: "10",
          firewall: true,
          rate: "",
        },
        keep,
      ),
    ).toBe(
      "virtio=BC:24:11:00:00:01,bridge=vmbr1,tag=10,firewall=1,queues=4,link_down=1",
    );
    expect(
      qemuNicValue({
        model: "e1000",
        mac: "",
        bridge: "vmbr0",
        tag: "",
        firewall: false,
        rate: "12.5",
      }),
    ).toBe("e1000,bridge=vmbr0,rate=12.5");
    expect(
      qemuNicProblem({
        model: "virtio",
        mac: "",
        bridge: "vmbr0",
        tag: "5000",
        firewall: false,
        rate: "",
      }),
    ).toBe("tag");
  });

  it("reads and writes a container adapter", () => {
    const raw =
      "name=eth0,bridge=vmbr0,hwaddr=BC:24:11:69:EE:4F,ip=192.168.0.50/24,gw=192.168.0.1,type=veth";
    const form = lxcNicForm(parseProps(raw).values);
    expect(form).toMatchObject({
      ip4: "static",
      cidr4: "192.168.0.50/24",
      gw4: "192.168.0.1",
      ip6: "none",
    });
    expect(lxcNicValue(form, parseProps(raw).values)).toBe(
      "name=eth0,bridge=vmbr0,hwaddr=BC:24:11:69:EE:4F,ip=192.168.0.50/24,gw=192.168.0.1,type=veth",
    );
    expect(
      lxcNicValue({ ...form, ip4: "dhcp", ip6: "auto", firewall: true }),
    ).toBe(
      "name=eth0,bridge=vmbr0,hwaddr=BC:24:11:69:EE:4F,ip=dhcp,ip6=auto,firewall=1",
    );
    expect(lxcNicProblem({ ...form, cidr4: "192.168.0.50" })).toBe("ip4");
    expect(lxcNicProblem({ ...form, name: "1eth" })).toBe("name");
  });
});
