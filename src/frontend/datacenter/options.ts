import type { PveParams } from "../api";

/** "type=secure,network=10.0.0.0/24" → { type: "secure", network: "…" }; a bare value goes under `first`. */
export function parseProps(
  value: unknown,
  first?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(value ?? "").split(",")) {
    if (!part.trim()) continue;
    const eq = part.indexOf("=");
    if (eq === -1) {
      if (first) out[first] = part.trim();
    } else {
      out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/** The reverse: empty values are left out; nothing left is undefined. */
export function composeProps(
  props: Record<string, string | undefined>,
): string | undefined {
  const text = Object.entries(props)
    .filter(([, v]) => v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `${k}=${String(v).trim()}`)
    .join(",");
  return text || undefined;
}

/** The datacenter options the panel edits, flattened for a form. */
export interface DcOptionsForm {
  keyboard: string;
  language: string;
  console: string;
  emailFrom: string;
  httpProxy: string;
  macPrefix: string;
  maxWorkers: string;
  migrationType: string;
  migrationNetwork: string;
  bwDefault: string;
  bwMigration: string;
  bwClone: string;
  bwRestore: string;
  bwMove: string;
  nextLower: string;
  nextUpper: string;
  haShutdown: string;
  tagStyleCase: boolean;
}

export function dcOptionsForm(
  o: Record<string, unknown> | null,
): DcOptionsForm {
  const migration = parseProps(o?.migration, "type");
  const bw = parseProps(o?.bwlimit);
  const next = parseProps(o?.["next-id"]);
  const ha = parseProps(o?.ha);
  const tag = parseProps(o?.["tag-style"]);
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  return {
    keyboard: s(o?.keyboard),
    language: s(o?.language),
    console: s(o?.console),
    emailFrom: s(o?.email_from),
    httpProxy: s(o?.http_proxy),
    macPrefix: s(o?.mac_prefix),
    maxWorkers: s(o?.max_workers),
    migrationType: migration.type ?? "",
    migrationNetwork: migration.network ?? "",
    bwDefault: bw.default ?? "",
    bwMigration: bw.migration ?? "",
    bwClone: bw.clone ?? "",
    bwRestore: bw.restore ?? "",
    bwMove: bw.move ?? "",
    nextLower: next.lower ?? "",
    nextUpper: next.upper ?? "",
    haShutdown: ha.shutdown_policy ?? "",
    tagStyleCase: tag["case-sensitive"] === "1",
  };
}

const CIDR = /^[0-9a-fA-F:.]+\/\d{1,3}$/;
const MAC_PREFIX = /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){0,4}$/;

/** A locale key for what is wrong, or null. */
export function dcOptionsProblem(f: DcOptionsForm): string | null {
  if (f.macPrefix && !MAC_PREFIX.test(f.macPrefix)) return "macPrefix";
  if (f.migrationNetwork && !CIDR.test(f.migrationNetwork)) return "network";
  if (f.httpProxy && !/^https?:\/\//.test(f.httpProxy)) return "proxy";
  for (const v of [
    f.maxWorkers,
    f.bwDefault,
    f.bwMigration,
    f.bwClone,
    f.bwRestore,
    f.bwMove,
    f.nextLower,
    f.nextUpper,
  ]) {
    if (v && !/^\d+$/.test(v)) return "number";
  }
  if (f.nextLower && f.nextUpper && Number(f.nextLower) >= Number(f.nextUpper))
    return "nextId";
  return null;
}

/**
 * PUT /cluster/options params: set what has a value, delete what was cleared
 * (only keys the panel owns, so options it doesn't show stay as they are).
 */
export function dcOptionsParams(f: DcOptionsForm): PveParams {
  const values: Record<string, string | undefined> = {
    keyboard: f.keyboard || undefined,
    language: f.language || undefined,
    console: f.console || undefined,
    email_from: f.emailFrom.trim() || undefined,
    http_proxy: f.httpProxy.trim() || undefined,
    mac_prefix: f.macPrefix.trim() || undefined,
    max_workers: f.maxWorkers || undefined,
    migration: f.migrationType
      ? composeProps({
          type: f.migrationType,
          network: f.migrationNetwork,
        })
      : undefined,
    bwlimit: composeProps({
      default: f.bwDefault,
      migration: f.bwMigration,
      clone: f.bwClone,
      restore: f.bwRestore,
      move: f.bwMove,
    }),
    "next-id": composeProps({ lower: f.nextLower, upper: f.nextUpper }),
    ha: f.haShutdown ? `shutdown_policy=${f.haShutdown}` : undefined,
    "tag-style": f.tagStyleCase ? "case-sensitive=1" : undefined,
  };
  const params: PveParams = {};
  const cleared: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) cleared.push(k);
    else params[k] = v;
  }
  if (cleared.length) params.delete = cleared.join(",");
  return params;
}

export const KEYBOARDS = [
  "da",
  "de",
  "de-ch",
  "en-gb",
  "en-us",
  "es",
  "fi",
  "fr",
  "fr-be",
  "fr-ca",
  "fr-ch",
  "hu",
  "is",
  "it",
  "ja",
  "lt",
  "mk",
  "nl",
  "no",
  "pl",
  "pt",
  "pt-br",
  "sl",
  "sv",
  "tr",
];

export const LANGUAGES = [
  "ar",
  "ca",
  "da",
  "de",
  "en",
  "es",
  "eu",
  "fa",
  "fr",
  "he",
  "hr",
  "it",
  "ja",
  "ka",
  "kr",
  "nb",
  "nl",
  "nn",
  "pl",
  "pt_BR",
  "ru",
  "sl",
  "sv",
  "tr",
  "ukr",
  "zh_CN",
  "zh_TW",
];
