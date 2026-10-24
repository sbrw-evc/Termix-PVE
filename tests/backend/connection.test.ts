import { describe, expect, it } from "vitest";
import {
  SETTINGS,
  parseHostConfig,
  resolveTransport,
} from "../../src/backend/pve/connection.js";

describe("parseHostConfig", () => {
  it("reads the host settings with defaults", () => {
    expect(parseHostConfig({})).toEqual({
      transport: "auto",
      tokenId: null,
      apiHost: null,
      apiPort: 8006,
      caCert: null,
    });
    expect(
      parseHostConfig({
        [SETTINGS.transport]: "direct",
        [SETTINGS.tokenId]: " root@pam!termix ",
        [SETTINGS.apiHost]: "pve.lan",
        [SETTINGS.apiPort]: 443,
        [SETTINGS.caCert]: "PEM",
      }),
    ).toEqual({
      transport: "direct",
      tokenId: "root@pam!termix",
      apiHost: "pve.lan",
      apiPort: 443,
      caCert: "PEM",
    });
  });

  it("falls back on values it can't use", () => {
    const config = parseHostConfig({
      [SETTINGS.transport]: "telnet",
      [SETTINGS.apiPort]: 70000,
      [SETTINGS.tokenId]: "   ",
    });
    expect(config).toMatchObject({
      transport: "auto",
      apiPort: 8006,
      tokenId: null,
    });
  });
});

describe("resolveTransport", () => {
  const config = parseHostConfig({});
  it("tunnels once a token is saved and uses pvesh until then", () => {
    expect(resolveTransport(config, true)).toBe("tunnel");
    expect(resolveTransport(config, false)).toBe("pvesh");
  });
  it("keeps an explicit choice", () => {
    expect(resolveTransport({ ...config, transport: "direct" }, false)).toBe(
      "direct",
    );
    expect(resolveTransport({ ...config, transport: "pvesh" }, true)).toBe(
      "pvesh",
    );
  });
});
