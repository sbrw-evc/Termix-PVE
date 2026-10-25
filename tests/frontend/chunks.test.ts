import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  UploadFailed,
  uploadInChunks,
  type ChunkAnswer,
} from "../../src/frontend/storage/chunks";

/** A node that keeps what it gets, answering like the upload route. */
function fakeNode(script: Array<(offset: number) => ChunkAnswer | "drop">) {
  let have = 0;
  const calls: Array<[number, number]> = [];
  const send = async (
    offset: number,
    end: number,
    onProgress: (sent: number) => void,
  ): Promise<ChunkAnswer> => {
    calls.push([offset, end]);
    const step = script.shift();
    const forced = step?.(offset);
    if (forced === "drop") throw new Error("network");
    if (forced) return forced;
    if (offset > have)
      return {
        status: 409,
        body: { code: "PVE_UPLOAD_OFFSET", received: have },
      };
    onProgress(end - offset);
    have = end;
    return { status: 200, body: { received: end, done: end === 100 } };
  };
  return { send, calls };
}

const run = (node: ReturnType<typeof fakeNode>, seen: number[] = []) =>
  uploadInChunks({
    total: 100,
    chunkSize: 40,
    send: node.send,
    onProgress: (sent) => seen.push(sent),
    cancelled: () => false,
    wait: async () => undefined,
  });

describe("chunked upload", () => {
  it("sends the file in chunks and ends at 100%", async () => {
    const node = fakeNode([]);
    const seen: number[] = [];
    await run(node, seen);
    expect(node.calls).toEqual([
      [0, 40],
      [40, 80],
      [80, 100],
    ]);
    expect(seen.at(-1)).toBe(100);
    // Progress only goes forward.
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("sends a chunk again when the connection drops", async () => {
    const node = fakeNode([() => undefined as never, () => "drop"]);
    await run(node);
    expect(node.calls).toEqual([
      [0, 40],
      [40, 80],
      [40, 80],
      [80, 100],
    ]);
  });

  it("carries on from what the node has when out of step", async () => {
    const node = fakeNode([
      () => ({ status: 409, body: { code: "PVE_UPLOAD_OFFSET", received: 0 } }),
    ]);
    await run(node);
    expect(node.calls[0]).toEqual([0, 40]);
    expect(node.calls[1]).toEqual([0, 40]);
  });

  it("stops at once on answers a retry can't fix", async () => {
    const node = fakeNode([
      () => ({
        status: 409,
        body: { code: "PVE_UPLOAD_EXISTS", error: "already there" },
      }),
    ]);
    await expect(run(node)).rejects.toMatchObject({
      message: "already there",
      status: 409,
    });
    expect(node.calls).toHaveLength(1);
  });

  it("gives up after repeated failures", async () => {
    const node = fakeNode(
      Array.from({ length: MAX_ATTEMPTS }, () => () => ({
        status: 502,
        body: { error: "node down" },
      })),
    );
    await expect(run(node)).rejects.toBeInstanceOf(UploadFailed);
    expect(node.calls).toHaveLength(MAX_ATTEMPTS);
  });

  it("stops when cancelled", async () => {
    let stop = false;
    const node = fakeNode([]);
    await expect(
      uploadInChunks({
        total: 100,
        chunkSize: 40,
        send: async (o, e, p) => {
          stop = true;
          return node.send(o, e, p);
        },
        onProgress: () => undefined,
        cancelled: () => stop,
      }),
    ).rejects.toMatchObject({ message: "cancelled" });
  });
});

describe("retry pauses", () => {
  it("doubles the pause and caps it at 30 seconds", async () => {
    const waits: number[] = [];
    await expect(
      uploadInChunks({
        total: 10,
        chunkSize: 10,
        send: async () => ({ status: 502, body: { error: "down" } }),
        onProgress: () => undefined,
        cancelled: () => false,
        wait: async (ms) => void waits.push(ms),
      }),
    ).rejects.toBeInstanceOf(UploadFailed);
    expect(waits).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000,
    ]);
  });
});
