import type { PluginHostRecord } from "@termix-ssh/plugin-sdk/frontend";
import { PLUGIN_ID } from "./api";

const DEFAULT_PORT = 8006;

type Settings = Record<string, unknown> | undefined;

const settingsOf = (
  host: Pick<PluginHostRecord, "pluginSettings"> | null | undefined,
): Settings => host?.pluginSettings?.[PLUGIN_ID] as Settings;

/**
 * Whether Termix reaches this node only through its HTTPS API. Consoles run
 * over SSH, so such a host gets Proxmox's own console pages instead.
 */
export function usesDirectApi(
  host: Pick<PluginHostRecord, "pluginSettings"> | null | undefined,
): boolean {
  return settingsOf(host)?.pveTransport === "direct";
}

/** The node's web interface: its API address and port, as the host settings name them. */
export function proxmoxBaseUrl(
  host: Pick<PluginHostRecord, "pluginSettings" | "ip"> | null | undefined,
): string | null {
  if (!host) return null;
  const s = settingsOf(host);
  const address =
    (typeof s?.pveApiHost === "string" && s.pveApiHost.trim()) ||
    String(host.ip ?? "");
  if (!address) return null;
  const port = Number(s?.pveApiPort);
  const p =
    Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
  const bracketed =
    address.includes(":") && !address.startsWith("[")
      ? `[${address}]`
      : address;
  return `https://${bracketed}:${p}`;
}

export type WebConsole =
  | { kind: "qemu"; node: string; vmid: number; name?: string }
  | { kind: "lxc"; node: string; vmid: number; name?: string }
  | { kind: "shell"; node: string; cmd?: "ceph_install" | "upgrade" };

/**
 * A console page of Proxmox's own web interface, the same URL its Console
 * buttons open: noVNC for VMs, xterm.js for containers and node shells.
 */
export function webConsoleUrl(base: string, target: WebConsole): string {
  const params = new URLSearchParams();
  if (target.kind === "qemu") {
    params.set("console", "kvm");
    params.set("novnc", "1");
  } else {
    params.set("console", target.kind);
    params.set("xtermjs", "1");
  }
  if (target.kind !== "shell") {
    params.set("vmid", String(target.vmid));
    if (target.name) params.set("vmname", target.name);
  }
  params.set("node", target.node);
  params.set("resize", "off");
  params.set("cmd", target.kind === "shell" ? (target.cmd ?? "") : "");
  return `${base}/?${params}`;
}

/** Opens a page in a new browser window, away from Termix. */
export function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
