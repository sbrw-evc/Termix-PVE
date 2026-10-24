import { describe, expect, it } from "vitest";
import {
  cloudInitChanges,
  cloudInitForm,
  optionsChanges,
  optionsForm,
  optionsProblem,
} from "../../src/frontend/guests/options/params";
import { guestIps } from "../../src/frontend/guests/ips";

describe("options", () => {
  const config = {
    name: "web",
    onboot: 1,
    startup: "order=2,up=30",
    tags: "prod;web",
    agent: "enabled=1,fstrim_cloned_disks=1",
    ostype: "l26",
  };

  it("reads the config into a form", () => {
    expect(optionsForm("qemu", config)).toMatchObject({
      name: "web",
      onboot: true,
      protection: false,
      startupOrder: "2",
      startupUp: "30",
      startupDown: "",
      tags: "prod, web",
      agent: true,
    });
    expect(optionsForm("qemu", { agent: "1" }).agent).toBe(true);
    expect(optionsForm("lxc", { hostname: "ct" }).name).toBe("ct");
  });

  it("sends only what changed, with empty values to delete", () => {
    const before = optionsForm("qemu", config);
    expect(optionsChanges("qemu", before, before)).toEqual({});
    expect(
      optionsChanges("qemu", before, {
        ...before,
        onboot: false,
        startupUp: "",
        tags: "prod",
        description: "",
      }),
    ).toEqual({ onboot: 0, startup: "order=2", tags: "prod" });
    expect(
      optionsChanges("lxc", optionsForm("lxc", {}), {
        ...optionsForm("lxc", {}),
        name: "ct2",
        nameserver: "1.1.1.1",
      }),
    ).toEqual({
      hostname: "ct2",
      nameserver: "1.1.1.1",
    });
  });

  it("checks values PVE would refuse", () => {
    const form = optionsForm("qemu", config);
    expect(optionsProblem("qemu", form)).toBeNull();
    expect(optionsProblem("qemu", { ...form, name: " " })).toBe("name");
    expect(optionsProblem("qemu", { ...form, startupOrder: "a" })).toBe(
      "startup",
    );
    expect(optionsProblem("qemu", { ...form, tags: "bad tag!" })).toBe("tags");
  });
});

describe("cloud-init", () => {
  it("decodes keys and reads the IP config", () => {
    const form = cloudInitForm({
      ciuser: "debian",
      sshkeys: encodeURIComponent("ssh-ed25519 AAAA me@pc"),
      ipconfig0: "ip=10.0.0.5/24,gw=10.0.0.1",
    });
    expect(form).toMatchObject({
      user: "debian",
      password: "",
      sshKeys: "ssh-ed25519 AAAA me@pc",
      ipMode: "static",
      cidr: "10.0.0.5/24",
      gateway: "10.0.0.1",
    });
  });

  it("encodes keys, sends a typed password and switches to DHCP", () => {
    const before = cloudInitForm({});
    expect(
      cloudInitChanges(before, {
        ...before,
        password: "pw",
        sshKeys: "ssh-ed25519 AAAA me@pc\n",
        ipMode: "dhcp",
      }),
    ).toEqual({
      cipassword: "pw",
      sshkeys: "ssh-ed25519%20AAAA%20me%40pc",
      ipconfig0: "ip=dhcp",
    });
    expect(cloudInitChanges(before, before)).toEqual({});
  });
});

describe("guestIps", () => {
  it("reads container interfaces", () => {
    expect(
      guestIps("lxc", [
        { name: "lo", inet: "127.0.0.1/8" },
        { name: "eth0", inet: "192.168.0.50/24", inet6: "fe80::1/64" },
      ]),
    ).toEqual(["192.168.0.50"]);
  });

  it("reads the guest agent's answer", () => {
    expect(
      guestIps("qemu", {
        result: [
          {
            name: "ens18",
            "ip-addresses": [
              { "ip-address": "10.0.0.5", "ip-address-type": "ipv4" },
              { "ip-address": "fd00::5", "ip-address-type": "ipv6" },
            ],
          },
        ],
      }),
    ).toEqual(["10.0.0.5", "fd00::5"]);
    expect(guestIps("qemu", null)).toEqual([]);
  });
});
