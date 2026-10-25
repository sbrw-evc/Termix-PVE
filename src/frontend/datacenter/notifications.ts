import type { PveParams } from "../api";

/** "a@x, b@x" or one per line → ["a@x", "b@x"]. */
export function splitList(value: unknown): string[] {
  return String(value ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function unbase64(text: string): string {
  try {
    const binary = atob(text);
    return new TextDecoder().decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    );
  } catch {
    return text;
  }
}

/**
 * Webhook headers and secrets: "Name: value" lines in the form, and
 * "name=Name,value=<base64>" entries for Proxmox.
 */
export function encodeKeyValues(lines: unknown): string[] {
  return String(lines ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(":");
      const name = (colon === -1 ? line : line.slice(0, colon)).trim();
      const value = colon === -1 ? "" : line.slice(colon + 1).trim();
      return `name=${name},value=${base64(value)}`;
    });
}

export function decodeKeyValues(entries: unknown): string {
  const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
  return list
    .map((e) => {
      const name = String(e).match(/(?:^|,)name=([^,]*)/)?.[1] ?? "";
      const value = String(e).match(/(?:^|,)value=([^,]*)/)?.[1] ?? "";
      return `${name}: ${unbase64(value)}`;
    })
    .join("\n");
}

export const SEVERITIES = ["info", "notice", "warning", "error", "unknown"];

/** One entry of GET /cluster/notifications/targets. */
export interface NotificationTarget extends Record<string, unknown> {
  name: string;
  type: "sendmail" | "smtp" | "gotify" | "webhook";
  comment?: string;
  disable?: number;
  origin?: "builtin" | "user-created" | "modified-builtin";
}

/** One entry of GET /cluster/notifications/matchers. */
export interface NotificationMatcher extends Record<string, unknown> {
  name: string;
  mode?: "all" | "any";
  target?: string[] | string;
  "match-severity"?: string[] | string;
  "match-field"?: string[] | string;
  "match-calendar"?: string[] | string;
  "invert-match"?: number;
  comment?: string;
  disable?: number;
  origin?: string;
}

/** Matcher params from the form: list fields become arrays; cleared ones are deleted. */
export function matcherParams(
  v: Record<string, string | boolean>,
  creating: boolean,
): PveParams {
  const params: PveParams = {
    mode: String(v.mode || "all"),
    "invert-match": v["invert-match"] === true ? 1 : 0,
    disable: v.disable === true ? 1 : 0,
    comment: String(v.comment ?? "").trim() || undefined,
  };
  if (creating) params.name = String(v.name);
  const cleared: string[] = [];
  for (const key of [
    "target",
    "match-severity",
    "match-field",
    "match-calendar",
  ]) {
    // Field matches may hold regexes with commas: one per line.
    const list =
      key === "match-field"
        ? String(v[key] ?? "")
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean)
        : splitList(v[key]);
    if (list.length) params[key] = list;
    else if (!creating) cleared.push(key);
  }
  if (!creating && !params.comment) cleared.push("comment");
  if (cleared.length) params.delete = cleared.join(",");
  return params;
}
