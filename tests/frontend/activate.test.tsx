import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import {
  renderWithApp,
  type RenderedPluginApp,
} from "@termix-ssh/plugin-sdk/testing";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";
import * as plugin from "../../src/frontend/index";
import manifestJson from "../../manifest.json";
import locales from "../../locales/en.json";

const manifest = manifestJson as unknown as PluginManifest;

const pveHost = {
  id: 1,
  name: "Proxmox",
  ip: "192.168.0.200",
  pluginSettings: { pve: { enablePve: true } },
};
const plainHost = {
  id: 2,
  name: "web",
  ip: "192.168.0.10",
  pluginSettings: {},
};

let rendered: RenderedPluginApp | null = null;

afterEach(async () => {
  await rendered?.deactivate();
  rendered = null;
});

describe(`${manifest.id} activate`, () => {
  it("registers the tab, a Tools rail item and the host action", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.tabs()).toEqual(["pve", "pve-console"]);
    expect(rendered.registered.panels()).toEqual(["pve-tree"]);
    expect(rendered.registered.railItems()).toEqual([
      expect.objectContaining({ id: "pve", permission: "pve.view" }),
      // No button; it only names the sidebar tree's header.
      expect.objectContaining({ id: "pve-tree", hidden: true }),
    ]);
    expect(rendered.registered.hostActions()).toEqual([
      expect.objectContaining({ id: "pve-open", tabType: "pve" }),
    ]);
    expect(rendered.registered.slot("shell.overlay")).toEqual(["pve.railSync"]);
  });

  it("hides the rail item until a host is a Proxmox node", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    const item = rendered.registered.railItems().find((i) => i.id === "pve");
    expect(item?.hidden).toBe(true);
  });

  it("offers Open in Proxmox only on Proxmox hosts", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    expect(rendered.registered.hostActionsFor(pveHost)).toEqual([
      // Tools is the way in; no extra button on the host row.
      expect.objectContaining({ id: "pve-open", tray: false }),
    ]);
    expect(rendered.registered.hostActionsFor(plainHost)).toHaveLength(0);
  });

  it("shows the tree in the left sidebar while the tab is on screen", async () => {
    rendered = await renderWithApp(plugin, { manifest, locales });
    rendered.renderTab("pve", { isVisible: true });
    expect(rendered.shellCalls).toContainEqual(
      expect.objectContaining({ method: "openRailView", args: ["pve-tree"] }),
    );
  });

  it("explains how to add a node when there is none", async () => {
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      hosts: [plainHost],
    });
    rendered.renderTab("pve", { isVisible: true });
    expect(await screen.findByText(locales.app.noHosts)).toBeTruthy();
  });

  it("shows why the cluster could not load", async () => {
    const post = vi.fn(async () => {
      throw Object.assign(new Error("Request failed"), {
        response: {
          data: {
            error: "raw message",
            code: "PVE_TLS_UNTRUSTED",
          },
        },
      });
    });
    rendered = await renderWithApp(plugin, {
      manifest,
      locales,
      hosts: [pveHost],
      api: { post, get: vi.fn() } as never,
    });
    rendered.renderTab("pve", { isVisible: true });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        locales.errors.tlsUntrusted,
      ),
    );
    expect(post).toHaveBeenCalledWith("/hosts/1/call", {
      method: "GET",
      path: ["cluster", "resources"],
      params: {},
    });
  });
});
