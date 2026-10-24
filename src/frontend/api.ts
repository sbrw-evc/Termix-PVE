import type {
  PluginHostRecord,
  TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import manifest from "../../manifest.json";

/** This plugin's id, the key its host settings sit under on a host record. */
export const PLUGIN_ID = manifest.id;

let current: TermixApp | null = null;

/** Set in activate, cleared on deactivate. */
export function setApp(app: TermixApp | null): void {
  current = app;
}

export function app(): TermixApp {
  if (!current) throw new Error("The Proxmox plugin is not active");
  return current;
}

/** Whether a host is marked as a Proxmox node in its settings. */
export function isPveHost(host: Pick<PluginHostRecord, "pluginSettings">) {
  return host.pluginSettings?.[PLUGIN_ID]?.enablePve === true;
}

export type PveMethod = "GET" | "POST" | "PUT" | "DELETE";
export type PveParams = Record<
  string,
  string | number | boolean | null | undefined
>;
export type PveTransport = "tunnel" | "direct" | "pvesh";

/** What a failed call carries, for the UI to show. */
export interface PveCallError {
  message: string;
  code?: string;
  fieldErrors?: Record<string, string>;
}

export function toCallError(err: unknown): PveCallError {
  const data = (
    err as {
      response?: {
        data?: {
          error?: string;
          code?: string;
          fieldErrors?: Record<string, string>;
        };
      };
    }
  )?.response?.data;
  if (data?.error) {
    return {
      message: data.error,
      code: data.code,
      fieldErrors: data.fieldErrors,
    };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

/** One Proxmox API call on a node, through the plugin's allow-listed proxy. */
export async function pve<T = unknown>(
  hostId: number,
  method: PveMethod,
  path: Array<string | number>,
  params?: PveParams,
): Promise<T> {
  const { data } = await app().api.post<{ data: T }>(`/hosts/${hostId}/call`, {
    method,
    path: path.map(String),
    params: params ?? {},
  });
  return data.data;
}

export interface PveConnection {
  transport: PveTransport;
  version: { version: string; release: string };
}

export async function testConnection(hostId: number): Promise<PveConnection> {
  return (await app().api.get<PveConnection>(`/hosts/${hostId}/connection`))
    .data;
}

/** One entry of /cluster/resources. */
export interface PveResource {
  id: string;
  type: string;
  node?: string;
  vmid?: number;
  name?: string;
  status?: string;
  template?: number;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  netin?: number;
  netout?: number;
  uptime?: number;
  storage?: string;
  pool?: string;
  tags?: string;
  hastate?: string;
  lock?: string;
}

export type GuestType = "qemu" | "lxc";

export interface PveClusterTask {
  upid: string;
  node: string;
  type: string;
  id?: string;
  user: string;
  starttime: number;
  endtime?: number;
  status?: string;
}

export interface PveTaskStatus {
  upid: string;
  node: string;
  status: "running" | "stopped";
  exitstatus?: string;
  type: string;
  id?: string;
  starttime: number;
}

const UPID_NODE_RE = /^UPID:([A-Za-z0-9._-]+):/;

/** The node a task runs on, read from its id. */
export function upidNode(upid: string): string | null {
  return UPID_NODE_RE.exec(upid)?.[1] ?? null;
}

export function isUpid(value: unknown): value is string {
  return typeof value === "string" && UPID_NODE_RE.test(value);
}

export function taskOk(status: { exitstatus?: string; status?: string }) {
  const exit = status.exitstatus ?? status.status ?? "";
  return exit === "OK" || exit.startsWith("WARNINGS");
}
