import { describe, expect, it, vi } from "vitest";
import type { PveClient, PveRequest } from "../../../src/backend/pve/client.js";
import {
  PveTaskFailedError,
  listRecentTasks,
  parseUpid,
  waitForTask,
} from "../../../src/backend/pve/tasks.js";

const UPID = "UPID:pve1:00001234:0000ABCD:65A1B2C3:qmstart:100:root@pam:";

function fakeClient(answers: unknown[]): PveClient & { calls: PveRequest[] } {
  const calls: PveRequest[] = [];
  return {
    transport: "pvesh",
    calls,
    async request<T>(request: PveRequest) {
      calls.push(request);
      return answers.shift() as T;
    },
  };
}

describe("parseUpid", () => {
  it("unpacks a task id", () => {
    expect(parseUpid(UPID)).toEqual({
      upid: UPID,
      node: "pve1",
      pid: 0x1234,
      startTime: 0x65a1b2c3,
      type: "qmstart",
      id: "100",
      user: "root@pam",
    });
    expect(
      parseUpid("UPID:pve1:00001234:0000ABCD:65A1B2C3:vzdump::root@pam!tok:"),
    ).toMatchObject({ type: "vzdump", id: "", user: "root@pam!tok" });
  });

  it("refuses anything else", () => {
    expect(parseUpid("UPID:pve1:bad")).toBeNull();
    expect(parseUpid("nodes/../etc")).toBeNull();
  });
});

describe("waitForTask", () => {
  const running = { upid: UPID, status: "running" };

  it("polls until the task stops and returns its status", async () => {
    const client = fakeClient([
      running,
      running,
      { upid: UPID, status: "stopped", exitstatus: "OK" },
    ]);
    const sleep = vi.fn(async () => {});
    const status = await waitForTask(client, UPID, { sleep, pollMs: 5 });
    expect(status.exitstatus).toBe("OK");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(client.calls[0].path).toEqual([
      "nodes",
      "pve1",
      "tasks",
      UPID,
      "status",
    ]);
  });

  it("counts warnings as success", async () => {
    const client = fakeClient([
      { upid: UPID, status: "stopped", exitstatus: "WARNINGS: 2" },
    ]);
    await expect(waitForTask(client, UPID)).resolves.toMatchObject({
      exitstatus: "WARNINGS: 2",
    });
  });

  it("throws the task's error when it failed", async () => {
    const client = fakeClient([
      {
        upid: UPID,
        type: "qmstart",
        status: "stopped",
        exitstatus: "start failed: no space",
      },
    ]);
    const err = await waitForTask(client, UPID).catch((e) => e);
    expect(err).toBeInstanceOf(PveTaskFailedError);
    expect(err.message).toContain("start failed: no space");
  });

  it("gives up after the timeout", async () => {
    const client = fakeClient(Array(10).fill(running));
    await expect(
      waitForTask(client, UPID, { timeoutMs: 0, sleep: async () => {} }),
    ).rejects.toMatchObject({ status: 504 });
  });

  it("refuses an invalid task id before calling Proxmox", async () => {
    const client = fakeClient([]);
    await expect(waitForTask(client, "nope")).rejects.toMatchObject({
      status: 400,
    });
    expect(client.calls).toHaveLength(0);
  });
});

describe("listRecentTasks", () => {
  it("sorts newest first and limits", async () => {
    const client = fakeClient([
      [
        { upid: "a", starttime: 1 },
        { upid: "b", starttime: 3 },
        { upid: "c", starttime: 2 },
      ],
    ]);
    const tasks = await listRecentTasks(client, 2);
    expect(tasks.map((t) => t.upid)).toEqual(["b", "c"]);
  });
});
