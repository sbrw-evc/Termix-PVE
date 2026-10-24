import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "ssh2";

const execCommand = vi.fn();
vi.mock("../../../src/backend/pve/exec.js", () => ({
  execCommand: (...args: unknown[]) => execCommand(...args),
}));

const execElevated = vi.fn();
vi.mock("@termix-ssh/plugin-sdk/host-commands", () => ({
  execElevated: (...args: unknown[]) => execElevated(...args),
}));

import { createPveshRunner } from "../../../src/backend/pve/pvesh-runner.js";

const client = {} as Client;
const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
const fail = { stdout: "", stderr: "only root can run this", code: 1 };

beforeEach(() => {
  execCommand.mockReset();
  execElevated.mockReset();
});

describe("createPveshRunner", () => {
  it("runs pvesh directly as root and checks the user once", async () => {
    execCommand.mockResolvedValueOnce(ok("0\n")).mockResolvedValue(ok("[]"));
    const run = createPveshRunner(client, "secret");

    await run("pvesh get /cluster/status", 1000);
    await run("pvesh get /cluster/resources", 1000);

    const commands = execCommand.mock.calls.map((c) => c[1]);
    expect(commands).toEqual([
      "id -u",
      "pvesh get /cluster/status",
      "pvesh get /cluster/resources",
    ]);
    expect(execElevated).not.toHaveBeenCalled();
  });

  it("uses the sudo password for a non-root user", async () => {
    execCommand.mockResolvedValueOnce(ok("1000\n"));
    execElevated.mockResolvedValue({ ...ok("[1]"), usedSudo: true });
    const run = createPveshRunner(client, "secret");

    await expect(run("pvesh get /cluster/status", 1000)).resolves.toMatchObject(
      { stdout: "[1]", code: 0 },
    );
    expect(execElevated).toHaveBeenCalledWith(
      client,
      "pvesh get /cluster/status",
      "secret",
      { forceSudo: true, timeoutMs: 1000 },
    );
  });

  it("tries passwordless sudo when no password is stored", async () => {
    execCommand
      .mockResolvedValueOnce(ok("1000\n"))
      .mockResolvedValueOnce(ok("[2]"));
    const run = createPveshRunner(client);

    await expect(run("pvesh get /cluster/status", 1000)).resolves.toMatchObject(
      { stdout: "[2]" },
    );
    expect(execCommand.mock.calls[1][1]).toBe(
      "sudo -n pvesh get /cluster/status",
    );
  });

  it("falls back to running as-is when sudo fails", async () => {
    execCommand
      .mockResolvedValueOnce(ok("1000\n"))
      .mockResolvedValueOnce(fail)
      .mockResolvedValueOnce(ok("[3]"));
    const run = createPveshRunner(client);

    await expect(run("pvesh get /cluster/status", 1000)).resolves.toMatchObject(
      { stdout: "[3]" },
    );
    expect(execCommand.mock.calls[2][1]).toBe("pvesh get /cluster/status");
  });
});
