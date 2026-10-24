import type { PveMethod } from "./client.js";
import type { PluginHostShareLevel } from "@termix-ssh/plugin-sdk/backend";

/**
 * What a call needs. Every Proxmox path the UI may reach is listed here; a
 * path no rule matches is refused, so the proxy route can never be used as
 * a general way into the node's API.
 *
 * - view: read anything listed.
 * - operate: power a guest on and off, open its console.
 * - configure: create, change, move and delete guests, disks and networks.
 * - administer: users, groups, roles, pools, 2FA, tokens, realms and the cluster.
 */
export type PvePermission = "view" | "operate" | "configure" | "administer";

export interface PveRule {
  method: PveMethod;
  /** Segments: a literal, ":name" for any one segment, "{a|b}" for one of these. */
  pattern: string;
  permission: PvePermission;
}

const GUEST = "nodes/:node/{qemu|lxc}/:vmid";

export const RULES: PveRule[] = [
  // Reading the cluster, nodes and guests.
  { method: "GET", pattern: "version", permission: "view" },
  { method: "GET", pattern: "cluster/resources", permission: "view" },
  { method: "GET", pattern: "cluster/status", permission: "view" },
  { method: "GET", pattern: "cluster/tasks", permission: "view" },
  { method: "GET", pattern: "cluster/nextid", permission: "view" },
  { method: "GET", pattern: "nodes", permission: "view" },
  { method: "GET", pattern: "nodes/:node/status", permission: "view" },
  { method: "GET", pattern: "nodes/:node/rrddata", permission: "view" },
  {
    method: "GET",
    pattern: "nodes/:node/tasks/:upid/status",
    permission: "view",
  },
  { method: "GET", pattern: "nodes/:node/tasks/:upid/log", permission: "view" },
  { method: "GET", pattern: "nodes/:node/{qemu|lxc}", permission: "view" },
  { method: "GET", pattern: "nodes/:node/storage", permission: "view" },
  {
    method: "GET",
    pattern: "nodes/:node/storage/:storage/content",
    permission: "view",
  },
  { method: "GET", pattern: "nodes/:node/network", permission: "view" },
  { method: "GET", pattern: `${GUEST}/status/current`, permission: "view" },
  { method: "GET", pattern: `${GUEST}/config`, permission: "view" },
  { method: "GET", pattern: `${GUEST}/rrddata`, permission: "view" },
  {
    method: "GET",
    pattern: "nodes/:node/qemu/:vmid/migrate",
    permission: "view",
  },

  // Power.
  {
    method: "POST",
    pattern: `${GUEST}/status/{start|stop|shutdown|reboot|suspend|resume|reset}`,
    permission: "operate",
  },

  // Creating, copying, moving and deleting guests.
  {
    method: "POST",
    pattern: "nodes/:node/{qemu|lxc}",
    permission: "configure",
  },
  { method: "POST", pattern: `${GUEST}/clone`, permission: "configure" },
  { method: "POST", pattern: `${GUEST}/template`, permission: "configure" },
  { method: "POST", pattern: `${GUEST}/migrate`, permission: "configure" },
  { method: "DELETE", pattern: GUEST, permission: "configure" },
];

function segmentMatches(rule: string, value: string): boolean {
  if (rule.startsWith(":")) return true;
  if (rule.startsWith("{") && rule.endsWith("}")) {
    return rule.slice(1, -1).split("|").includes(value);
  }
  return rule === value;
}

/** The rule that allows this call, or null when none does. */
export function findRule(
  method: PveMethod,
  path: string[],
  rules: PveRule[] = RULES,
): PveRule | null {
  for (const rule of rules) {
    if (rule.method !== method) continue;
    const parts = rule.pattern.split("/");
    if (parts.length !== path.length) continue;
    if (parts.every((part, i) => segmentMatches(part, path[i]))) return rule;
  }
  return null;
}

/** The share level the caller needs on the Termix host for a permission. */
export function hostLevelFor(permission: PvePermission): PluginHostShareLevel {
  return permission === "view" ? "connect" : "edit";
}
