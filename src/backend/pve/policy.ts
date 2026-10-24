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
  /**
   * When set, the only parameter names the call may send, and the only keys
   * its "delete" may list. For paths that also change things we don't offer.
   */
  params?: RegExp;
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

  // Hardware, disks, network adapters and options of a guest.
  { method: "GET", pattern: `${GUEST}/pending`, permission: "view" },
  {
    method: "GET",
    pattern: "nodes/:node/lxc/:vmid/interfaces",
    permission: "view",
  },
  {
    method: "GET",
    pattern: "nodes/:node/qemu/:vmid/agent/network-get-interfaces",
    permission: "view",
  },
  { method: "PUT", pattern: `${GUEST}/config`, permission: "configure" },
  { method: "PUT", pattern: `${GUEST}/resize`, permission: "configure" },
  {
    method: "POST",
    pattern: "nodes/:node/qemu/:vmid/move_disk",
    permission: "configure",
  },
  {
    method: "POST",
    pattern: "nodes/:node/lxc/:vmid/move_volume",
    permission: "configure",
  },
  {
    method: "GET",
    pattern: "nodes/:node/qemu/:vmid/cloudinit",
    permission: "view",
  },
  {
    method: "PUT",
    pattern: "nodes/:node/qemu/:vmid/cloudinit",
    permission: "configure",
  },

  // Storage content: ISO images, CT templates, backups and disk images.
  {
    method: "GET",
    pattern: "nodes/:node/storage/:storage/status",
    permission: "view",
  },
  {
    method: "GET",
    pattern: "nodes/:node/storage/:storage/content/:volume",
    permission: "view",
  },
  {
    method: "DELETE",
    pattern: "nodes/:node/storage/:storage/content/:volume",
    permission: "configure",
  },
  {
    method: "POST",
    pattern: "nodes/:node/storage/:storage/download-url",
    permission: "configure",
  },
  { method: "GET", pattern: "nodes/:node/aplinfo", permission: "view" },
  { method: "POST", pattern: "nodes/:node/aplinfo", permission: "configure" },

  // Nodes. Their logs and power need administer.
  { method: "GET", pattern: "nodes/:node/services", permission: "view" },
  {
    method: "POST",
    pattern: "nodes/:node/services/:service/{start|stop|restart|reload}",
    permission: "administer",
  },
  { method: "GET", pattern: "nodes/:node/syslog", permission: "administer" },
  { method: "GET", pattern: "nodes/:node/journal", permission: "administer" },
  { method: "GET", pattern: "nodes/:node/apt/update", permission: "view" },
  {
    method: "POST",
    pattern: "nodes/:node/apt/update",
    permission: "administer",
  },
  { method: "GET", pattern: "nodes/:node/apt/versions", permission: "view" },
  { method: "GET", pattern: "nodes/:node/disks/list", permission: "view" },
  { method: "GET", pattern: "nodes/:node/disks/smart", permission: "view" },
  { method: "POST", pattern: "nodes/:node/status", permission: "administer" },

  // Node system: DNS, /etc/hosts, time zone, certificates, apt repositories,
  // storage on its disks and its task history. Changes need administer.
  { method: "GET", pattern: "nodes/:node/dns", permission: "view" },
  { method: "PUT", pattern: "nodes/:node/dns", permission: "administer" },
  { method: "GET", pattern: "nodes/:node/hosts", permission: "view" },
  { method: "POST", pattern: "nodes/:node/hosts", permission: "administer" },
  { method: "GET", pattern: "nodes/:node/time", permission: "view" },
  { method: "PUT", pattern: "nodes/:node/time", permission: "administer" },
  {
    method: "GET",
    pattern: "nodes/:node/certificates/info",
    permission: "view",
  },
  {
    method: "GET",
    pattern: "nodes/:node/apt/repositories",
    permission: "view",
  },
  {
    method: "POST",
    pattern: "nodes/:node/apt/repositories",
    permission: "administer",
  },
  {
    method: "PUT",
    pattern: "nodes/:node/apt/repositories",
    permission: "administer",
  },
  {
    method: "GET",
    pattern: "nodes/:node/disks/{lvm|lvmthin|directory|zfs}",
    permission: "view",
  },
  { method: "GET", pattern: "nodes/:node/disks/zfs/:pool", permission: "view" },
  { method: "GET", pattern: "nodes/:node/tasks", permission: "view" },

  // Storage on the node's disks. Creating and wiping erase disks.
  {
    method: "POST",
    pattern: "nodes/:node/disks/{lvm|lvmthin|directory|zfs}",
    permission: "administer",
  },
  {
    method: "DELETE",
    pattern: "nodes/:node/disks/{lvm|lvmthin|directory|zfs}/:name",
    permission: "administer",
  },
  {
    method: "POST",
    pattern: "nodes/:node/disks/initgpt",
    permission: "administer",
  },
  {
    method: "PUT",
    pattern: "nodes/:node/disks/wipedisk",
    permission: "administer",
  },

  // Certificates: a custom one, or one ordered through ACME. The node's
  // config is reachable only for its ACME account and domains.
  {
    method: "POST",
    pattern: "nodes/:node/certificates/custom",
    permission: "administer",
  },
  {
    method: "DELETE",
    pattern: "nodes/:node/certificates/custom",
    permission: "administer",
  },
  {
    method: "POST",
    pattern: "nodes/:node/certificates/acme/certificate",
    permission: "administer",
  },
  {
    method: "PUT",
    pattern: "nodes/:node/certificates/acme/certificate",
    permission: "administer",
  },
  {
    method: "DELETE",
    pattern: "nodes/:node/certificates/acme/certificate",
    permission: "administer",
  },
  { method: "GET", pattern: "nodes/:node/config", permission: "view" },
  {
    method: "PUT",
    pattern: "nodes/:node/config",
    permission: "administer",
    params: /^(acme|acmedomain\d|digest|delete)$/,
  },
  {
    method: "GET",
    pattern: "cluster/acme/{directories|tos|meta|challenge-schema}",
    permission: "view",
  },
  // Accounts carry a contact address and plugins the DNS provider's keys.
  { method: "GET", pattern: "cluster/acme/account", permission: "administer" },
  {
    method: "GET",
    pattern: "cluster/acme/account/:name",
    permission: "administer",
  },
  { method: "POST", pattern: "cluster/acme/account", permission: "administer" },
  {
    method: "PUT",
    pattern: "cluster/acme/account/:name",
    permission: "administer",
  },
  {
    method: "DELETE",
    pattern: "cluster/acme/account/:name",
    permission: "administer",
  },
  { method: "GET", pattern: "cluster/acme/plugins", permission: "administer" },
  {
    method: "GET",
    pattern: "cluster/acme/plugins/:id",
    permission: "administer",
  },
  { method: "POST", pattern: "cluster/acme/plugins", permission: "administer" },
  {
    method: "PUT",
    pattern: "cluster/acme/plugins/:id",
    permission: "administer",
  },
  {
    method: "DELETE",
    pattern: "cluster/acme/plugins/:id",
    permission: "administer",
  },

  // Node network. Changes go to interfaces.new until applied.
  { method: "GET", pattern: "nodes/:node/network/:iface", permission: "view" },
  { method: "POST", pattern: "nodes/:node/network", permission: "administer" },
  { method: "PUT", pattern: "nodes/:node/network", permission: "administer" },
  {
    method: "DELETE",
    pattern: "nodes/:node/network",
    permission: "administer",
  },
  {
    method: "PUT",
    pattern: "nodes/:node/network/:iface",
    permission: "administer",
  },
  {
    method: "DELETE",
    pattern: "nodes/:node/network/:iface",
    permission: "administer",
  },
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

/**
 * Whether a call's parameters fit its rule. A rule without `params` takes
 * any; otherwise every name, and every key a "delete" lists, must match.
 */
export function paramsAllowed(
  rule: PveRule,
  params: Record<string, unknown> = {},
): boolean {
  if (!rule.params) return true;
  const allowed = rule.params;
  return Object.entries(params).every(([key, value]) => {
    if (!allowed.test(key)) return false;
    if (key !== "delete") return true;
    return String(value ?? "")
      .split(/[,;\s]+/)
      .filter(Boolean)
      .every(
        (name) => name !== "delete" && name !== "digest" && allowed.test(name),
      );
  });
}

/** The share level the caller needs on the Termix host for a permission. */
export function hostLevelFor(permission: PvePermission): PluginHostShareLevel {
  return permission === "view" ? "connect" : "edit";
}
