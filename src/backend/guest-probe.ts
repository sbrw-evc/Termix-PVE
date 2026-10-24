/**
 * What a guest runs: its OS from the Proxmox config or the QEMU guest agent,
 * and whether Docker or Podman is installed, asked inside the guest with
 * `pct exec` and `qm guest exec` over SSH on the node.
 */

import type { Client } from "ssh2";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { shellQuote } from "./pve/client.js";
import { createPveshRunner } from "./pve/pvesh-runner.js";

export type OsFamily = "windows" | "linux" | "other";

export interface GuestOs {
  family: OsFamily;
  /** "Debian", "Windows 11", or the agent's pretty name. Null when unknown. */
  label: string | null;
}

/** Docker or Podman inside a guest; null when it could not be asked. */
export interface GuestRuntimes {
  docker: boolean;
  podman: boolean;
}

const QEMU_OS: Record<string, GuestOs> = {
  win11: { family: "windows", label: "Windows 11/2022/2025" },
  win10: { family: "windows", label: "Windows 10/2016/2019" },
  win8: { family: "windows", label: "Windows 8/2012" },
  win7: { family: "windows", label: "Windows 7/2008 R2" },
  w2k8: { family: "windows", label: "Windows Vista/2008" },
  wvista: { family: "windows", label: "Windows Vista" },
  w2k3: { family: "windows", label: "Windows 2003" },
  wxp: { family: "windows", label: "Windows XP" },
  w2k: { family: "windows", label: "Windows 2000" },
  l26: { family: "linux", label: "Linux" },
  l24: { family: "linux", label: "Linux 2.4" },
  solaris: { family: "other", label: "Solaris" },
};

const LXC_NAMES: Record<string, string> = {
  debian: "Debian",
  ubuntu: "Ubuntu",
  centos: "CentOS",
  fedora: "Fedora",
  opensuse: "openSUSE",
  archlinux: "Arch Linux",
  alpine: "Alpine",
  gentoo: "Gentoo",
  nixos: "NixOS",
  devuan: "Devuan",
};

/** The OS a guest's config declares: `ostype` on VMs and containers alike. */
export function osFromConfig(
  type: "qemu" | "lxc",
  config: Record<string, unknown>,
): GuestOs {
  const ostype = typeof config.ostype === "string" ? config.ostype : "";
  if (type === "lxc") {
    // Every container is Linux; "unmanaged" says nothing more.
    return {
      family: "linux",
      label:
        LXC_NAMES[ostype] ?? (ostype && ostype !== "unmanaged" ? ostype : null),
    };
  }
  return QEMU_OS[ostype] ?? { family: "other", label: null };
}

/** The OS the guest agent reports (agent/get-osinfo), more exact than ostype. */
export function osFromAgent(data: unknown): GuestOs | null {
  const info = (data as { result?: Record<string, unknown> })?.result;
  if (!info || typeof info !== "object") return null;
  const id = String(info.id ?? "").toLowerCase();
  const label = String(info["pretty-name"] ?? info.name ?? "").trim() || null;
  if (id === "mswindows" || /windows/i.test(label ?? "")) {
    return { family: "windows", label };
  }
  if (!id && !label) return null;
  return { family: "linux", label };
}

/** The agent is switched on in a VM config ("1" or "enabled=1,…"). */
export function agentEnabled(config: Record<string, unknown>): boolean {
  return /^(1|enabled=1)(,|$)/.test(String(config.agent ?? ""));
}

const CHECK =
  "printf +; command -v docker >/dev/null 2>&1 && printf d; command -v podman >/dev/null 2>&1 && printf p; true";

/**
 * One shell script asking every guest at once: a line "<vmid> <flags>" each,
 * "+" then d and p. VMs answer through the agent, as JSON with out-data.
 */
export function probeScript(
  guests: Array<{ type: "qemu" | "lxc"; vmid: number }>,
): string {
  const check = shellQuote(CHECK);
  return guests
    .map(({ type, vmid }) =>
      type === "lxc"
        ? `printf '%s ' ${vmid}; timeout 15 pct exec ${vmid} -- sh -c ${check} 2>/dev/null; echo`
        : `printf '%s ' ${vmid}; timeout 15 qm guest exec ${vmid} --timeout 10 -- sh -c ${check} 2>/dev/null | tr -d '\\n'; echo`,
    )
    .join("\n");
}

/** Reads probeScript's output. Guests that did not answer are left out. */
export function parseProbe(stdout: string): Map<number, GuestRuntimes> {
  const out = new Map<number, GuestRuntimes>();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^(\d+) ?(.*)$/);
    if (!match) continue;
    let flags = match[2].trim();
    if (flags.startsWith("{")) {
      // qm guest exec: {"exitcode":0,"exited":1,"out-data":"+dp"}
      try {
        const parsed = JSON.parse(flags) as { "out-data"?: string };
        flags = parsed["out-data"] ?? "";
      } catch {
        continue;
      }
    }
    // No "+": the command never ran inside the guest.
    if (!/^\+d?p?$/.test(flags)) continue;
    out.set(Number(match[1]), {
      docker: flags.includes("d"),
      podman: flags.includes("p"),
    });
  }
  return out;
}

/**
 * Asks running guests on the node this host is for which runtimes they have.
 * pct and qm reach only local guests, so guests on other cluster nodes are
 * left unknown. Fails soft: no answer is an empty map.
 */
export async function probeRuntimes(
  ctx: PluginContext,
  hostId: number,
  guests: Array<{ type: "qemu" | "lxc"; vmid: number; node: string }>,
): Promise<Map<number, GuestRuntimes>> {
  if (!guests.length) return new Map();
  try {
    const resolved = await ctx.ssh.resolveHost(hostId).catch(() => null);
    const sudoPassword =
      (resolved?.sudoPassword as string | undefined) || undefined;
    return await ctx.ssh.withConnection<Map<number, GuestRuntimes>, Client>(
      hostId,
      { pool: "pve-probe", purpose: "proxmox-import" },
      async (client) => {
        const run = createPveshRunner(client, sudoPassword);
        const local = (await run("hostname", 10000)).stdout.trim();
        const here = guests.filter((g) => g.node === local);
        if (!here.length) return new Map();
        const result = await run(
          `sh -c ${shellQuote(probeScript(here))}`,
          20000 + here.length * 5000,
        );
        return parseProbe(result.stdout);
      },
    );
  } catch (err) {
    ctx.log.warn(
      `Runtime probe on host ${hostId} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return new Map();
  }
}
