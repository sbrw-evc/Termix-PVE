import type { PveParams } from "../api";

/** One ACME domain of a node: acmedomainN or the old acme "domains" list. */
export interface AcmeDomain {
  domain: string;
  /** A DNS plugin id; empty for the built-in HTTP challenge (standalone). */
  plugin: string;
  alias: string;
}

export interface AcmeNodeConfig {
  account: string;
  domains: AcmeDomain[];
}

/** "domain=a.b,plugin=cf" or "a.b" → key/value pairs; the first bare value is the default key. */
function propertyString(value: string, defaultKey: string) {
  const out: Record<string, string> = {};
  for (const part of value.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) {
      if (part.trim()) out[defaultKey] = part.trim();
    } else {
      out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

/** GET /nodes/{node}/config → the account and domains, old and new style. */
export function parseAcmeConfig(
  config: Record<string, unknown> | null,
): AcmeNodeConfig {
  const acme = propertyString(String(config?.acme ?? ""), "account");
  const domains: AcmeDomain[] = (acme.domains ?? "")
    .split(";")
    .filter(Boolean)
    .map((domain) => ({ domain, plugin: "", alias: "" }));
  const keys = Object.keys(config ?? {})
    .filter((k) => /^acmedomain\d$/.test(k))
    .sort();
  for (const key of keys) {
    const d = propertyString(String(config![key]), "domain");
    if (d.domain) {
      domains.push({
        domain: d.domain,
        plugin: d.plugin === "standalone" ? "" : (d.plugin ?? ""),
        alias: d.alias ?? "",
      });
    }
  }
  return { account: acme.account ?? "", domains };
}

/** acmedomain0 to acmedomain5: Proxmox allows six. */
export const MAX_ACME_DOMAINS = 6;

const DOMAIN =
  /^(\*\.)?[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function acmeConfigProblem(c: AcmeNodeConfig): string | null {
  if (!c.domains.length) return "noDomain";
  if (c.domains.length > MAX_ACME_DOMAINS) return "tooMany";
  for (const d of c.domains) {
    if (!DOMAIN.test(d.domain.trim())) return "domain";
    // A wildcard needs the DNS challenge.
    if (d.domain.startsWith("*.") && !d.plugin) return "wildcard";
  }
  return null;
}

/**
 * PUT /nodes/{node}/config params: the account, one acmedomainN per domain,
 * and the slots no longer used deleted. The old "domains" list moves into
 * acmedomainN, so it is written without it.
 */
export function acmeConfigParams(
  c: AcmeNodeConfig,
  previous: Record<string, unknown> | null,
): PveParams {
  const params: PveParams = {
    acme: c.account ? `account=${c.account}` : undefined,
  };
  c.domains.forEach((d, i) => {
    params[`acmedomain${i}`] = [
      `domain=${d.domain.trim()}`,
      d.plugin ? `plugin=${d.plugin}` : null,
      d.alias.trim() ? `alias=${d.alias.trim()}` : null,
    ]
      .filter(Boolean)
      .join(",");
  });
  const stale = Object.keys(previous ?? {}).filter(
    (k) => /^acmedomain\d$/.test(k) && Number(k.slice(10)) >= c.domains.length,
  );
  if (!c.account) stale.push("acme");
  if (stale.length) params.delete = stale.join(",");
  return params;
}

/** DNS plugin settings as PVE stores them: KEY=value lines, base64 encoded. */
export function encodePluginData(fields: Record<string, string>): string {
  const text = Object.entries(fields)
    .filter(([, v]) => v.trim() !== "")
    .map(([k, v]) => `${k}=${v.trim()}`)
    .join("\n");
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

/** One entry of GET /cluster/acme/challenge-schema. */
export interface ChallengeSchema {
  id: string;
  name: string;
  type: string;
  schema?: {
    fields?: Record<
      string,
      { description?: string; type?: string; optional?: number }
    >;
  };
}

/** One entry of GET /cluster/acme/plugins. */
export interface AcmePlugin {
  plugin: string;
  type: "dns" | "standalone";
  api?: string;
  disable?: number;
}

/** A plugin id for the API: letters, digits, "-" and "_". */
export function pluginIdProblem(id: string): string | null {
  return /^[A-Za-z][A-Za-z0-9\-_]*$/.test(id) ? null : "pluginId";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AccountForm {
  name: string;
  email: string;
  directory: string;
  acceptTos: boolean;
  eabKid: string;
  eabHmac: string;
}

export function accountProblem(
  f: AccountForm,
  tos: string | null,
): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9\-_.]*$/.test(f.name)) return "name";
  if (!EMAIL.test(f.email.trim())) return "email";
  if (!/^https?:\/\//.test(f.directory)) return "directory";
  if (tos && !f.acceptTos) return "tos";
  if (!!f.eabKid.trim() !== !!f.eabHmac.trim()) return "eab";
  return null;
}

export function accountParams(f: AccountForm, tos: string | null): PveParams {
  return {
    name: f.name,
    contact: f.email.trim(),
    directory: f.directory,
    tos_url: tos && f.acceptTos ? tos : undefined,
    "eab-kid": f.eabKid.trim() || undefined,
    "eab-hmac-key": f.eabHmac.trim() || undefined,
  };
}
