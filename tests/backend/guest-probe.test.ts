import { describe, expect, it } from "vitest";
import {
  agentEnabled,
  osFromAgent,
  osFromConfig,
  parseProbe,
  probeScript,
} from "../../src/backend/guest-probe.js";

describe("guest OS", () => {
  it("reads ostype from VM and container configs", () => {
    expect(osFromConfig("qemu", { ostype: "win11" }).family).toBe("windows");
    // Older Windows ostypes do not start with "win".
    for (const ostype of ["w2k8", "wvista", "w2k3", "wxp", "w2k"]) {
      expect(osFromConfig("qemu", { ostype }).family).toBe("windows");
    }
    expect(osFromConfig("qemu", { ostype: "l26" })).toEqual({
      family: "linux",
      label: "Linux",
    });
    expect(osFromConfig("qemu", {})).toEqual({ family: "other", label: null });
    expect(osFromConfig("lxc", { ostype: "ubuntu" })).toEqual({
      family: "linux",
      label: "Ubuntu",
    });
    expect(osFromConfig("lxc", { ostype: "unmanaged" }).label).toBeNull();
  });

  it("prefers what the guest agent reports", () => {
    expect(
      osFromAgent({
        result: { id: "mswindows", "pretty-name": "Windows Server 2022" },
      }),
    ).toEqual({ family: "windows", label: "Windows Server 2022" });
    expect(
      osFromAgent({ result: { id: "debian", "pretty-name": "Debian 13" } }),
    ).toEqual({ family: "linux", label: "Debian 13" });
    expect(osFromAgent(null)).toBeNull();
    expect(osFromAgent({ result: {} })).toBeNull();
  });

  it("knows when the agent is on", () => {
    expect(agentEnabled({ agent: "1" })).toBe(true);
    expect(agentEnabled({ agent: "enabled=1,fstrim_cloned_disks=1" })).toBe(
      true,
    );
    expect(agentEnabled({ agent: "0" })).toBe(false);
    expect(agentEnabled({})).toBe(false);
  });
});

describe("container runtimes", () => {
  it("asks containers with pct and VMs through the agent", () => {
    const script = probeScript([
      { type: "lxc", vmid: 300 },
      { type: "qemu", vmid: 101 },
    ]);
    expect(script).toContain("pct exec 300 -- sh -c ");
    expect(script).toContain("qm guest exec 101 --timeout 10 -- sh -c ");
    expect(script.split("\n")).toHaveLength(2);
  });

  it("reads the answers and skips guests that gave none", () => {
    const out = [
      "300 +d",
      "301 +dp",
      "302 +",
      // pct exec failed: unknown, not "no Docker".
      "303 ",
      '101 {"exitcode":0,"exited":1,"out-data":"+p"}',
      "102 garbage",
      "",
    ].join("\n");
    expect(parseProbe(out)).toEqual(
      new Map([
        [300, { docker: true, podman: false }],
        [301, { docker: true, podman: true }],
        [302, { docker: false, podman: false }],
        [101, { docker: false, podman: true }],
      ]),
    );
  });
});
