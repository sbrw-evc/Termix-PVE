import { afterEach, describe, expect, it, vi } from "vitest";
import type { TermixApp } from "@termix-ssh/plugin-sdk/frontend";
import { setApp } from "../../src/frontend/api";
import { setConfig } from "../../src/frontend/guests/useGuestConfig";

const guest = { hostId: 1, node: "pve1", type: "lxc" as const, vmid: 400 };

afterEach(() => setApp(null));

describe("setConfig", () => {
  it("sets values, deletes empty ones and sends the digest", async () => {
    const post = vi.fn(async () => ({ data: { data: null } }));
    setApp({ api: { post } } as unknown as TermixApp);
    await setConfig(
      guest,
      { memory: 1024, onboot: true, description: "", mp0: null },
      "d1",
    );
    expect(post).toHaveBeenCalledWith("/hosts/1/call", {
      method: "PUT",
      path: ["nodes", "pve1", "lxc", "400", "config"],
      params: {
        memory: 1024,
        onboot: true,
        delete: "description,mp0",
        digest: "d1",
      },
    });
  });
});
