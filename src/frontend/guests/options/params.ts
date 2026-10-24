import type { GuestType } from "../../api";
import { formatProps, parseProps, type GuestConfig } from "../config";

/** The options a form edits, as plain strings and booleans. */
export interface OptionsForm {
  name: string;
  onboot: boolean;
  protection: boolean;
  startupOrder: string;
  startupUp: string;
  startupDown: string;
  description: string;
  tags: string;
  /** qemu only. */
  agent: boolean;
  ostype: string;
  /** lxc only. */
  nameserver: string;
  searchdomain: string;
}

export function optionsForm(type: GuestType, config: GuestConfig): OptionsForm {
  const startup = parseProps(config.startup).values;
  const agent = parseProps(config.agent);
  return {
    name: String((type === "qemu" ? config.name : config.hostname) ?? ""),
    onboot: Number(config.onboot ?? 0) === 1,
    protection: Number(config.protection ?? 0) === 1,
    startupOrder: startup.order ?? "",
    startupUp: startup.up ?? "",
    startupDown: startup.down ?? "",
    description: String(config.description ?? ""),
    tags: String(config.tags ?? "")
      .split(/[;, ]/)
      .filter(Boolean)
      .join(", "),
    // "1", or "enabled=1,fstrim_cloned_disks=1".
    agent: agent.head === "1" || agent.values.enabled === "1",
    ostype: String(config.ostype ?? ""),
    nameserver: String(config.nameserver ?? ""),
    searchdomain: String(config.searchdomain ?? ""),
  };
}

const NUM_RE = /^\d*$/;
const TAG_RE = /^[a-z0-9_][a-z0-9_.+-]*$/i;

export function optionsProblem(type: GuestType, f: OptionsForm): string | null {
  if (!f.name.trim()) return "name";
  if (
    ![f.startupOrder, f.startupUp, f.startupDown].every((v) => NUM_RE.test(v))
  ) {
    return "startup";
  }
  const tags = f.tags.split(/[;, ]/).filter(Boolean);
  if (!tags.every((tag) => TAG_RE.test(tag))) return "tags";
  if (type === "lxc" && f.nameserver && /[^0-9a-fA-F.: ]/.test(f.nameserver)) {
    return "nameserver";
  }
  return null;
}

/**
 * Only the keys that changed, with "" for keys to delete, so a save never
 * rewrites what the user did not touch.
 */
export function optionsChanges(
  type: GuestType,
  before: OptionsForm,
  after: OptionsForm,
): Record<string, string | number | null> {
  const changes: Record<string, string | number | null> = {};
  const changed = (k: keyof OptionsForm) => before[k] !== after[k];

  if (changed("name"))
    changes[type === "qemu" ? "name" : "hostname"] = after.name.trim();
  if (changed("onboot")) changes.onboot = after.onboot ? 1 : 0;
  if (changed("protection")) changes.protection = after.protection ? 1 : 0;
  if (
    changed("startupOrder") ||
    changed("startupUp") ||
    changed("startupDown")
  ) {
    changes.startup = formatProps({
      values: {
        order: after.startupOrder,
        up: after.startupUp,
        down: after.startupDown,
      },
    });
  }
  if (changed("description")) changes.description = after.description;
  if (changed("tags")) {
    changes.tags = after.tags.split(/[;, ]/).filter(Boolean).join(";");
  }
  if (type === "qemu") {
    if (changed("agent"))
      changes.agent = after.agent ? "enabled=1" : "enabled=0";
    if (changed("ostype")) changes.ostype = after.ostype;
  } else {
    if (changed("nameserver")) changes.nameserver = after.nameserver.trim();
    if (changed("searchdomain"))
      changes.searchdomain = after.searchdomain.trim();
  }
  // Empty strings delete the key, which is how PVE goes back to its default.
  return changes;
}

// Cloud-init

export interface CloudInitForm {
  user: string;
  /** Empty keeps the saved password; PVE never sends it back. */
  password: string;
  sshKeys: string;
  ipMode: "dhcp" | "static" | "none";
  cidr: string;
  gateway: string;
  nameserver: string;
  searchdomain: string;
}

export function cloudInitForm(config: GuestConfig): CloudInitForm {
  const ip = parseProps(config.ipconfig0).values;
  let sshKeys = "";
  try {
    // PVE keeps the keys URL-encoded.
    sshKeys = decodeURIComponent(String(config.sshkeys ?? ""));
  } catch {
    sshKeys = String(config.sshkeys ?? "");
  }
  return {
    user: String(config.ciuser ?? ""),
    password: "",
    sshKeys,
    ipMode: ip.ip === "dhcp" ? "dhcp" : ip.ip ? "static" : "none",
    cidr: ip.ip && ip.ip !== "dhcp" ? ip.ip : "",
    gateway: ip.gw ?? "",
    nameserver: String(config.nameserver ?? ""),
    searchdomain: String(config.searchdomain ?? ""),
  };
}

export function cloudInitChanges(
  before: CloudInitForm,
  after: CloudInitForm,
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  if (before.user !== after.user) changes.ciuser = after.user.trim();
  if (after.password) changes.cipassword = after.password;
  if (before.sshKeys !== after.sshKeys) {
    changes.sshkeys = after.sshKeys.trim()
      ? encodeURIComponent(after.sshKeys.trim())
      : "";
  }
  if (
    before.ipMode !== after.ipMode ||
    before.cidr !== after.cidr ||
    before.gateway !== after.gateway
  ) {
    changes.ipconfig0 =
      after.ipMode === "dhcp"
        ? "ip=dhcp"
        : after.ipMode === "static"
          ? formatProps({ values: { ip: after.cidr, gw: after.gateway } })
          : "";
  }
  if (before.nameserver !== after.nameserver)
    changes.nameserver = after.nameserver.trim();
  if (before.searchdomain !== after.searchdomain)
    changes.searchdomain = after.searchdomain.trim();
  return changes;
}
