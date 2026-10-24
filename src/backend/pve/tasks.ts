import { PveError, type PveClient } from "./client.js";

/** The fields packed into a Proxmox task id. */
export interface Upid {
  upid: string;
  node: string;
  pid: number;
  /** Unix seconds the task started. */
  startTime: number;
  type: string;
  id: string;
  user: string;
}

// UPID:node:pid:pstart:starttime:type:id:user:
const UPID_RE =
  /^UPID:([A-Za-z0-9._-]+):([0-9A-Fa-f]{8}):([0-9A-Fa-f]{8,}):([0-9A-Fa-f]{8}):([^:]+):([^:]*):([^:]+):$/;

export function parseUpid(upid: string): Upid | null {
  const m = UPID_RE.exec(upid);
  if (!m) return null;
  return {
    upid,
    node: m[1],
    pid: Number.parseInt(m[2], 16),
    startTime: Number.parseInt(m[4], 16),
    type: m[5],
    id: m[6],
    user: m[7],
  };
}

export interface PveTaskStatus {
  upid: string;
  node: string;
  type: string;
  id?: string;
  user: string;
  status: "running" | "stopped";
  /** "OK", "WARNINGS: n" or the error, once stopped. */
  exitstatus?: string;
  starttime: number;
  pid?: number;
}

export interface PveTaskLogLine {
  n: number;
  t: string;
}

export function taskSucceeded(status: PveTaskStatus): boolean {
  return (
    status.status === "stopped" &&
    (status.exitstatus === "OK" ||
      (status.exitstatus ?? "").startsWith("WARNINGS"))
  );
}

function nodeOf(upid: string): string {
  const parsed = parseUpid(upid);
  if (!parsed) throw new PveError("Invalid task id", "PVE_BAD_REQUEST", 400);
  return parsed.node;
}

export function getTaskStatus(
  client: PveClient,
  upid: string,
): Promise<PveTaskStatus> {
  return client.request<PveTaskStatus>({
    path: ["nodes", nodeOf(upid), "tasks", upid, "status"],
  });
}

export function getTaskLog(
  client: PveClient,
  upid: string,
  options: { start?: number; limit?: number } = {},
): Promise<PveTaskLogLine[]> {
  return client.request<PveTaskLogLine[]>({
    path: ["nodes", nodeOf(upid), "tasks", upid, "log"],
    params: { start: options.start ?? 0, limit: options.limit ?? 500 },
  });
}

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

/** Recent tasks across the cluster, newest first. */
export async function listRecentTasks(
  client: PveClient,
  limit = 50,
): Promise<PveClusterTask[]> {
  const tasks =
    (await client.request<PveClusterTask[]>({
      path: ["cluster", "tasks"],
    })) ?? [];
  return [...tasks]
    .sort((a, b) => (b.starttime ?? 0) - (a.starttime ?? 0))
    .slice(0, limit);
}

export class PveTaskFailedError extends PveError {
  constructor(readonly task: PveTaskStatus) {
    super(
      `Task ${task.type} failed: ${task.exitstatus ?? "unknown error"}`,
      "PVE_API_ERROR",
      502,
    );
    this.name = "PveTaskFailedError";
  }
}

/**
 * Polls a task until it stops. Resolves with its final status, or throws
 * PveTaskFailedError when it ended in an error and a PveError on timeout.
 */
export async function waitForTask(
  client: PveClient,
  upid: string,
  options: {
    timeoutMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
    onStatus?: (status: PveTaskStatus) => void;
  } = {},
): Promise<PveTaskStatus> {
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  const pollMs = options.pollMs ?? 1000;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await getTaskStatus(client, upid);
    options.onStatus?.(status);
    if (status.status === "stopped") {
      if (!taskSucceeded(status)) throw new PveTaskFailedError(status);
      return status;
    }
    if (Date.now() >= deadline) {
      throw new PveError(
        `Task did not finish within ${Math.round(timeoutMs / 1000)}s`,
        "PVE_UNREACHABLE",
        504,
      );
    }
    await sleep(pollMs);
  }
}
