import { afterEach, describe, expect, it, vi } from "vitest";
import net from "node:net";
import zlib from "node:zlib";
import { PassThrough } from "node:stream";
import {
  PveError,
  buildPveshCommand,
  createDirectClient,
  createPveshClient,
  createTunnelClient,
  decodeBody,
  fetchFailure,
  isValidTokenId,
  parseApiResponse,
  pveParamEntries,
  pvePath,
  shellQuote,
} from "../../../src/backend/pve/client.js";

const token = { tokenId: "root@pam!termix", secret: "s3cret" };

let server: net.Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

describe("pvePath", () => {
  it("joins safe segments", () => {
    expect(pvePath(["nodes", "pve-1", "qemu", 100, "status", "start"])).toBe(
      "/nodes/pve-1/qemu/100/status/start",
    );
    expect(
      pvePath([
        "nodes",
        "pve1",
        "tasks",
        "UPID:pve1:00001234:0000ABCD:65A1B2C3:qmstart:100:root@pam:",
        "log",
      ]),
    ).toContain("UPID:pve1");
  });

  it("keeps a volume id as one segment, encoded only for the API", () => {
    const path = [
      "nodes",
      "pve1",
      "storage",
      "local",
      "content",
      "local:iso/debian 13.iso".replace(" ", "-"),
    ];
    expect(pvePath(path)).toBe(
      "/nodes/pve1/storage/local/content/local:iso/debian-13.iso",
    );
    expect(pvePath(path, true)).toBe(
      "/nodes/pve1/storage/local/content/local%3Aiso%2Fdebian-13.iso",
    );
    for (const bad of [
      "local:iso/../etc",
      "local:../x",
      "a/b",
      "local:iso//x",
      "local:iso/x?y",
    ]) {
      expect(() => pvePath(["nodes", bad])).toThrow(PveError);
    }
  });

  it("refuses segments that could leave the path", () => {
    for (const bad of ["..", ".", "a/b", "a b", "a?b", "a#b", "", "a;rm"]) {
      expect(() => pvePath(["nodes", bad])).toThrow(PveError);
    }
    expect(() => pvePath([])).toThrow(PveError);
  });
});

describe("pveParamEntries", () => {
  it("drops empty values and sends booleans as 1 and 0", () => {
    expect(
      pveParamEntries({
        a: true,
        b: false,
        c: null,
        d: undefined,
        e: 5,
        f: "x",
      }),
    ).toEqual([
      ["a", "1"],
      ["b", "0"],
      ["e", "5"],
      ["f", "x"],
    ]);
  });

  it("accepts indexed keys like net[0] and refuses odd ones", () => {
    expect(pveParamEntries({ "net[0]": "x" })).toEqual([["net[0]", "x"]]);
    expect(() => pveParamEntries({ "--evil": 1 })).toThrow(PveError);
    expect(() => pveParamEntries({ "a b": 1 })).toThrow(PveError);
  });
});

describe("isValidTokenId", () => {
  it("takes user@realm!name only", () => {
    expect(isValidTokenId("root@pam!termix")).toBe(true);
    expect(isValidTokenId("ops@pve!ci-1")).toBe(true);
    expect(isValidTokenId("root@pam")).toBe(false);
    expect(isValidTokenId("root!x")).toBe(false);
  });
});

describe("parseApiResponse", () => {
  it("unwraps data", () => {
    expect(parseApiResponse(200, "OK", '{"data":[1,2]}')).toEqual([1, 2]);
    expect(parseApiResponse(200, "OK", '{"data":null}')).toBeNull();
  });

  it("maps statuses to codes and keeps field errors", () => {
    const err = (() => {
      try {
        parseApiResponse(
          400,
          "Parameter verification failed.",
          '{"data":null,"errors":{"memory":"value must be at least 16"}}',
        );
      } catch (e) {
        return e as PveError;
      }
    })();
    expect(err).toBeInstanceOf(PveError);
    expect(err?.code).toBe("PVE_BAD_REQUEST");
    expect(err?.status).toBe(400);
    expect(err?.message).toBe("Parameter verification failed.");
    expect(err?.fieldErrors).toEqual({ memory: "value must be at least 16" });

    expect(() => parseApiResponse(401, "authentication failure", "")).toThrow(
      expect.objectContaining({ code: "PVE_AUTH_FAILED", status: 401 }),
    );
    expect(() => parseApiResponse(501, "Method not implemented", "")).toThrow(
      expect.objectContaining({ code: "PVE_NOT_FOUND" }),
    );
    expect(() => parseApiResponse(500, "boom", "")).toThrow(
      expect.objectContaining({ code: "PVE_API_ERROR", status: 502 }),
    );
  });

  it("refuses an unreadable success body", () => {
    expect(() => parseApiResponse(200, "OK", "<html>")).toThrow(
      expect.objectContaining({ code: "PVE_BAD_OUTPUT" }),
    );
  });
});

describe("pvesh transport", () => {
  it("builds a quoted pvesh command per method", () => {
    expect(buildPveshCommand({ path: ["cluster", "resources"] })).toBe(
      "pvesh get '/cluster/resources' --output-format json",
    );
    expect(
      buildPveshCommand({
        method: "POST",
        path: ["nodes", "pve1", "qemu", 100, "snapshot"],
        params: {
          snapname: "pre-upgrade",
          description: "it's fine",
          vmstate: true,
        },
      }),
    ).toBe(
      "pvesh create '/nodes/pve1/qemu/100/snapshot' --snapname 'pre-upgrade' --description 'it'\\''s fine' --vmstate '1' --output-format json",
    );
    expect(buildPveshCommand({ method: "PUT", path: ["a"] })).toMatch(
      /^pvesh set /,
    );
    expect(buildPveshCommand({ method: "DELETE", path: ["a"] })).toMatch(
      /^pvesh delete /,
    );
  });

  it("quotes for a POSIX shell", () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'");
  });

  it("parses JSON output and bare UPIDs", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: '[{"id":"node/pve1"}]\n',
        stderr: "",
        code: 0,
      })
      .mockResolvedValueOnce({
        stdout: "UPID:pve1:00001234:0000ABCD:65A1B2C3:qmstart:100:root@pam:\n",
        stderr: "",
        code: 0,
      })
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 });
    const client = createPveshClient(run);
    expect(client.transport).toBe("pvesh");
    await expect(
      client.request({ path: ["cluster", "resources"] }),
    ).resolves.toEqual([{ id: "node/pve1" }]);
    await expect(
      client.request({
        method: "POST",
        path: ["nodes", "pve1", "qemu", 100, "status", "start"],
      }),
    ).resolves.toMatch(/^UPID:/);
    await expect(
      client.request({ method: "DELETE", path: ["x"] }),
    ).resolves.toBeNull();
    expect(run.mock.calls[0][1]).toBe(30000);
  });

  it("turns pvesh failures into PveErrors", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: "",
        stderr:
          "400 Parameter verification failed.\nmemory: value must be at least 16\n",
        code: 255,
      })
      .mockResolvedValueOnce({
        stdout: "",
        stderr:
          "Configuration file 'nodes/pve1/qemu-server/999.conf' does not exist\n",
        code: 2,
      })
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 1 });
    const client = createPveshClient(run);
    await expect(client.request({ path: ["a"] })).rejects.toMatchObject({
      code: "PVE_BAD_REQUEST",
      fieldErrors: { memory: "value must be at least 16" },
    });
    await expect(client.request({ path: ["a"] })).rejects.toMatchObject({
      code: "PVE_NOT_FOUND",
    });
    await expect(client.request({ path: ["a"] })).rejects.toMatchObject({
      code: "PVE_API_ERROR",
      message: "pvesh exited with code 1",
    });
  });
});

/** What undici's fetch throws: "fetch failed" with the reason as its cause. */
function undiciError(code: string, message = code): Error {
  const cause = Object.assign(new Error(message), { code });
  return new TypeError("fetch failed", { cause });
}

describe("fetchFailure", () => {
  const origin = "https://192.168.0.200:8006";

  it("names an untrusted certificate and how to fix it", () => {
    const err = fetchFailure(
      origin,
      undiciError("UNABLE_TO_GET_ISSUER_CERT_LOCALLY"),
      false,
    );
    expect(err.code).toBe("PVE_TLS_UNTRUSTED");
    expect(err.message).toContain("/etc/pve/pve-root-ca.pem");
    expect(err.message).toContain("UNABLE_TO_GET_ISSUER_CERT_LOCALLY");
  });

  it("says the saved CA is the wrong one when there is one", () => {
    const err = fetchFailure(
      origin,
      undiciError("SELF_SIGNED_CERT_IN_CHAIN"),
      true,
    );
    expect(err.code).toBe("PVE_TLS_UNTRUSTED");
    expect(err.message).toContain("not signed by the CA saved");
  });

  it("tells hostname and expiry problems apart", () => {
    expect(
      fetchFailure(origin, undiciError("ERR_TLS_CERT_ALTNAME_INVALID"), true)
        .code,
    ).toBe("PVE_TLS_HOSTNAME");
    expect(
      fetchFailure(origin, undiciError("CERT_HAS_EXPIRED"), true).code,
    ).toBe("PVE_TLS_EXPIRED");
  });

  it("keeps the underlying reason for other failures", () => {
    const err = fetchFailure(
      origin,
      undiciError("ECONNREFUSED", "connect ECONNREFUSED 192.168.0.200:8006"),
      false,
    );
    expect(err.code).toBe("PVE_UNREACHABLE");
    expect(err.message).toBe(
      "Could not reach the Proxmox API at https://192.168.0.200:8006: fetch failed (connect ECONNREFUSED 192.168.0.200:8006)",
    );
    expect(fetchFailure(origin, new Error("boom"), false).message).toBe(
      "Could not reach the Proxmox API at https://192.168.0.200:8006: boom",
    );
  });
});

describe("direct transport", () => {
  it("sends the token, query and form body through ctx.fetch", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('{"data":"UPID:x"}', { status: 200, statusText: "OK" }),
    );
    const client = createDirectClient(fetchFn, {
      host: "10.0.0.5",
      token,
      caCert: "PEM",
    });

    await client.request({ path: ["cluster", "tasks"], params: { limit: 5 } });
    const [getUrl, getInit] = fetchFn.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(getUrl).toBe(
      "https://10.0.0.5:8006/api2/json/cluster/tasks?limit=5",
    );
    expect(getInit).toMatchObject({
      method: "GET",
      body: undefined,
      allowPrivateHosts: ["10.0.0.5"],
      tls: { ca: "PEM" },
      headers: { Authorization: "PVEAPIToken=root@pam!termix=s3cret" },
    });

    await client.request({
      method: "POST",
      path: ["nodes", "pve1", "qemu", 100, "status", "shutdown"],
      params: { forceStop: true, timeout: 60 },
    });
    const [postUrl, postInit] = fetchFn.mock.calls[1] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(postUrl).toBe(
      "https://10.0.0.5:8006/api2/json/nodes/pve1/qemu/100/status/shutdown",
    );
    expect(postInit.body).toBe("forceStop=1&timeout=60");
    expect(postInit.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("reports an untrusted certificate from fetch", async () => {
    const client = createDirectClient(
      async () => {
        throw undiciError("UNABLE_TO_GET_ISSUER_CERT_LOCALLY");
      },
      { host: "192.168.0.200", token },
    );
    await expect(client.request({ path: ["version"] })).rejects.toMatchObject({
      code: "PVE_TLS_UNTRUSTED",
      status: 502,
    });
  });

  it("reports a network failure as unreachable and refuses odd hosts", async () => {
    const client = createDirectClient(
      async () => {
        throw new Error("ECONNREFUSED");
      },
      { host: "pve.lan", port: 443, token },
    );
    await expect(client.request({ path: ["version"] })).rejects.toMatchObject({
      code: "PVE_UNREACHABLE",
    });
    expect(() =>
      createDirectClient(vi.fn(), { host: "evil.com/x?", token }),
    ).toThrow(PveError);
  });
});

describe("decodeBody", () => {
  const json = '{"data":["Oct 24 05:32:11 proxmox systemd[1]: Started"]}';
  it("unpacks what PVE compressed, like the journal", () => {
    expect(decodeBody(zlib.gzipSync(json), "gzip")).toBe(json);
    expect(decodeBody(zlib.deflateSync(json), "deflate")).toBe(json);
    expect(decodeBody(zlib.brotliCompressSync(json), "br")).toBe(json);
  });
  it("leaves plain bodies alone", () => {
    expect(decodeBody(Buffer.from(json), undefined)).toBe(json);
    expect(decodeBody(Buffer.from(json), "identity")).toBe(json);
  });
});

describe("tunnel transport", () => {
  it("reports a stream that cannot open as unreachable", async () => {
    const client = createTunnelClient(
      () => Promise.reject(new PveError("no forward", "PVE_UNREACHABLE")),
      token,
    );
    await expect(client.request({ path: ["version"] })).rejects.toMatchObject({
      code: "PVE_UNREACHABLE",
    });
  });

  it("times out when the node never answers", async () => {
    // A stream that swallows the TLS hello and never replies.
    const openStream = vi.fn(async () => new PassThrough());
    const client = createTunnelClient(openStream, token);
    await expect(
      client.request({ path: ["version"], timeoutMs: 50 }),
    ).rejects.toMatchObject({ code: "PVE_UNREACHABLE" });
    expect(openStream).toHaveBeenCalledTimes(1);
  });

  it("speaks TLS over the stream it is given, not to a local port", async () => {
    // Stands in for the SSH channel: whatever the client writes lands here.
    const firstBytes = new Promise<Buffer>((resolve) => {
      server = net.createServer((socket) => {
        socket.once("data", (chunk: Buffer) => {
          resolve(chunk);
          socket.destroy();
        });
      });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const { port } = server!.address() as net.AddressInfo;
    const client = createTunnelClient(
      async () => net.connect(port, "127.0.0.1"),
      token,
    );
    await expect(
      client.request({ path: ["version"], timeoutMs: 2000 }),
    ).rejects.toBeInstanceOf(PveError);
    // 0x16 opens a TLS handshake record: the ClientHello.
    expect((await firstBytes)[0]).toBe(0x16);
  });
});
