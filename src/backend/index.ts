import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { registerRoutes } from "./routes.js";

export async function activate(ctx: PluginContext) {
  registerRoutes(ctx, ctx.http.router<Router>());
  ctx.log.info("Proxmox routes mounted at /plugin-api/pve");
}

export async function deactivate() {
  // Everything registered through ctx is disposed by core.
}
