import type { PveParams } from "../api";
import type { FormValues } from "./crud";

/** One entry of GET /cluster/backup. */
export interface BackupJob extends Record<string, unknown> {
  id: string;
  schedule?: string;
  storage?: string;
  node?: string;
  all?: number;
  vmid?: string;
  pool?: string;
  exclude?: string;
  mode?: string;
  compress?: string;
  enabled?: number;
  comment?: string;
  "notes-template"?: string;
  "prune-backups"?: string;
  "next-run"?: number;
}

export type Selection = "all" | "exclude" | "vmid" | "pool";

export const KEEP = [
  "keep-last",
  "keep-hourly",
  "keep-daily",
  "keep-weekly",
  "keep-monthly",
  "keep-yearly",
] as const;

/** "keep-last=3,keep-daily=7" as a map; "keep-all=1" as an empty one. */
export function parsePrune(value?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (value ?? "").split(",")) {
    const [key, number] = part.split("=");
    if ((KEEP as readonly string[]).includes(key) && number) out[key] = number;
  }
  return out;
}

export function formatPrune(values: FormValues): string | undefined {
  const parts = KEEP.map((key) => {
    const number = String(values[key] ?? "").trim();
    return number && Number(number) > 0 ? `${key}=${Number(number)}` : null;
  }).filter(Boolean);
  return parts.length ? parts.join(",") : undefined;
}

/** A job as the form shows it: which guests, and retention as numbers. */
export function jobToForm(
  job: Record<string, unknown>,
): Record<string, unknown> {
  const selection: Selection = job.all
    ? job.exclude
      ? "exclude"
      : "all"
    : job.pool
      ? "pool"
      : "vmid";
  return {
    ...job,
    selection,
    ...parsePrune(job["prune-backups"] as string | undefined),
  };
}

/** The params of a job, for create and update. */
export function jobParams(values: FormValues, creating: boolean): PveParams {
  const text = (key: string) => String(values[key] ?? "").trim();
  const selection = (text("selection") || "all") as Selection;
  const params: PveParams = {
    schedule: text("schedule"),
    storage: text("storage"),
    mode: text("mode") || "snapshot",
    compress: text("compress") || "zstd",
    enabled: values.enabled === true ? 1 : 0,
  };
  const cleared: string[] = [];
  const optional = (key: string, value: string | undefined) => {
    if (value) params[key] = value;
    else cleared.push(key);
  };
  optional("node", text("node") || undefined);
  optional("comment", text("comment") || undefined);
  optional("notes-template", text("notes-template") || undefined);
  optional("prune-backups", formatPrune(values));
  // Exactly one way of picking guests is sent; the others are cleared.
  params.all = selection === "all" || selection === "exclude" ? 1 : 0;
  optional("exclude", selection === "exclude" ? text("exclude") : undefined);
  optional("vmid", selection === "vmid" ? text("vmid") : undefined);
  optional("pool", selection === "pool" ? text("pool") : undefined);
  if (creating) {
    if (text("id")) params.id = text("id");
  } else if (cleared.length) {
    params.delete = cleared.join(",");
  }
  return params;
}

/**
 * The params of a one-off vzdump that does what a job does, for Run now.
 * Proxmox's own Run now sends the job's settings to each node the same way.
 */
export function vzdumpFromJob(job: BackupJob): PveParams {
  const params: PveParams = {
    storage: job.storage,
    mode: job.mode ?? "snapshot",
    compress: job.compress ?? "zstd",
  };
  if (job.all) {
    params.all = 1;
    if (job.exclude) params.exclude = job.exclude;
  } else if (job.pool) {
    params.pool = job.pool;
  } else if (job.vmid) {
    params.vmid = job.vmid;
  }
  if (job["notes-template"]) params["notes-template"] = job["notes-template"];
  if (job["prune-backups"]) params["prune-backups"] = job["prune-backups"];
  return params;
}

/** A backup's volume id, "pbs:backup/vm/100/2026-10-24T10:00:00Z", made short for a list. */
export function backupLabel(volid: string): string {
  const name = volid.split("/").pop() ?? volid;
  return name.replace(/\.(tar|vma)(\.(zst|gz|lzo))?$/, "");
}
