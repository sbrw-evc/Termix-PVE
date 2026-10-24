import type { PveParams } from "../api";
import { paramsFrom, type FieldSpec, type FormValues } from "./crud";

/** One rule of GET …/firewall/rules. */
export interface FirewallRule extends Record<string, unknown> {
  pos: number;
  type: "in" | "out" | "forward" | "group";
  action: string;
  macro?: string;
  proto?: string;
  source?: string;
  dest?: string;
  dport?: string;
  sport?: string;
  iface?: string;
  enable?: number;
  log?: string;
  comment?: string;
}

export type FirewallScope = "cluster" | "node" | "guest";

export const ACTIONS = ["ACCEPT", "DROP", "REJECT"];
export const LOG_LEVELS = [
  "nolog",
  "emerg",
  "alert",
  "crit",
  "err",
  "warning",
  "notice",
  "info",
  "debug",
];
export const PROTOCOLS = [
  "tcp",
  "udp",
  "icmp",
  "icmpv6",
  "esp",
  "ah",
  "gre",
  "sctp",
];

/** A rule's one-line summary: direction, action, what and where. */
export function ruleSummary(rule: FirewallRule): string {
  const what = rule.macro ?? rule.proto ?? "";
  const ports = [
    rule.sport && `sport ${rule.sport}`,
    rule.dport && `dport ${rule.dport}`,
  ]
    .filter(Boolean)
    .join(" ");
  const route = [rule.source ?? "*", rule.dest ?? "*"].join(" → ");
  return [
    rule.type.toUpperCase(),
    rule.action,
    what,
    route,
    ports,
    rule.iface && `iface ${rule.iface}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** A rule as the form shows it: a group rule keeps its group in its own field. */
export function ruleToForm(
  rule: Record<string, unknown>,
): Record<string, unknown> {
  return rule.type === "group"
    ? { ...rule, group: rule.action, action: "" }
    : rule;
}

/** Params for a rule: a group rule's action is the group's name. */
export function ruleParams(
  fields: FieldSpec[],
  values: FormValues,
  creating: boolean,
): PveParams {
  const params = paramsFrom(fields, values, creating);
  if (values.type === "group") params.action = String(values.group ?? "");
  // The macro decides the protocol and ports; Proxmox refuses both together.
  if (values.macro) {
    for (const key of ["proto", "dport", "sport"]) delete params[key];
  }
  return params;
}

/**
 * Proxmox's moveto: the rule is put in front of the rule now at that
 * position, so one step down is two ahead (past the next rule).
 */
export function moveTarget(pos: number, direction: "up" | "down"): number {
  return direction === "up" ? Math.max(0, pos - 1) : pos + 2;
}
