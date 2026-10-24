import { describe, expect, it } from "vitest";
import {
  aclParams,
  memberChanges,
  tokensOf,
  totpSecret,
  totpUri,
} from "../../src/frontend/datacenter/access";
import {
  moveTarget,
  ruleParams,
  ruleSummary,
  ruleToForm,
} from "../../src/frontend/datacenter/firewall";
import { nextReplicationId } from "../../src/frontend/datacenter/ReplicationPanel";
import { haSid } from "../../src/frontend/datacenter/HaPanel";

describe("access", () => {
  it("lists every user's tokens", () => {
    expect(
      tokensOf([
        { userid: "root@pam", tokens: [{ tokenid: "termix", privsep: 0 }] },
        { userid: "bob@pve" },
      ]),
    ).toEqual([{ userid: "root@pam", tokenid: "termix", privsep: 0 }]);
  });

  it("adds and removes permissions with PUT", () => {
    expect(
      aclParams({
        path: "/vms/100",
        type: "group",
        ugid: "ops",
        roleid: "PVEVMUser",
        propagate: true,
      }),
    ).toEqual({
      path: "/vms/100",
      roles: "PVEVMUser",
      groups: "ops",
      propagate: 1,
    });
    expect(
      aclParams(
        {
          path: "/",
          type: "token",
          ugid: "root@pam!t",
          roleid: "PVEAuditor",
          propagate: 0,
        },
        true,
      ),
    ).toEqual({
      path: "/",
      roles: "PVEAuditor",
      tokens: "root@pam!t",
      propagate: 0,
      delete: 1,
    });
  });

  it("makes TOTP secrets authenticator apps read", () => {
    // RFC 4648: "Hello!\xDE\xAD\xBE\xEF" and its base32.
    const bytes = new Uint8Array([
      72, 101, 108, 108, 111, 33, 222, 173, 190, 239,
    ]);
    expect(totpSecret(() => bytes)).toBe("JBSWY3DPEHPK3PXP");
    expect(totpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    expect(totpUri("bob@pve", "ABC")).toBe(
      "otpauth://totp/Proxmox%20VE%3Abob%40pve?secret=ABC&issuer=Proxmox%20VE&algorithm=SHA1&digits=6&period=30",
    );
  });

  it("works out pool member changes", () => {
    expect(memberChanges(["100", "101"], ["101", "102"])).toEqual({
      add: ["102"],
      remove: ["100"],
    });
  });
});

describe("firewall", () => {
  const fields = [
    { key: "type", labelKey: "t" },
    {
      key: "action",
      labelKey: "a",
      showIf: (v: Record<string, unknown>) => v.type !== "group",
    },
    { key: "group", labelKey: "g", local: true },
    { key: "macro", labelKey: "m" },
    { key: "proto", labelKey: "p" },
    { key: "dport", labelKey: "d" },
  ];

  it("summarizes rules", () => {
    expect(
      ruleSummary({
        pos: 0,
        type: "in",
        action: "ACCEPT",
        macro: "SSH",
        source: "10.0.0.0/24",
      }),
    ).toBe("IN ACCEPT SSH 10.0.0.0/24 → *");
    expect(
      ruleSummary({
        pos: 1,
        type: "out",
        action: "DROP",
        proto: "tcp",
        dport: "25",
      }),
    ).toBe("OUT DROP tcp * → * dport 25");
  });

  it("keeps a group rule's group apart from the action", () => {
    expect(ruleToForm({ type: "group", action: "web" })).toMatchObject({
      group: "web",
      action: "",
    });
    expect(ruleParams(fields, { type: "group", group: "web" }, true)).toEqual({
      type: "group",
      action: "web",
    });
  });

  it("drops protocol and ports when a macro decides them", () => {
    expect(
      ruleParams(
        fields,
        {
          type: "in",
          action: "ACCEPT",
          macro: "SSH",
          proto: "tcp",
          dport: "22",
        },
        true,
      ),
    ).toEqual({
      type: "in",
      action: "ACCEPT",
      macro: "SSH",
    });
  });

  it("moves rules one step", () => {
    expect(moveTarget(0, "up")).toBe(0);
    expect(moveTarget(3, "up")).toBe(2);
    expect(moveTarget(3, "down")).toBe(5);
  });
});

describe("replication and HA", () => {
  it("numbers replication jobs per guest", () => {
    expect(nextReplicationId("100", [])).toBe("100-0");
    expect(
      nextReplicationId("100", [
        { id: "100-0" },
        { id: "1000-1" },
        { id: "100-2" },
      ]),
    ).toBe("100-1");
  });

  it("names HA resources", () => {
    expect(haSid("qemu", 100)).toBe("vm:100");
    expect(haSid("lxc", "101")).toBe("ct:101");
  });
});
