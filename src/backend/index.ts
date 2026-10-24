import type { Router } from "express";
import type { PluginContext } from "@termix-ssh/plugin-sdk/backend";
import { registerRoutes } from "./routes.js";
import { registerConsole } from "./console.js";
import { registerUpload } from "./upload.js";
import { registerImport } from "./import.js";

export async function activate(ctx: PluginContext) {
  const router = ctx.http.router<Router>();
  registerRoutes(ctx, router);
  // Uploads stream their body: core only parses JSON and form bodies.
  registerUpload(ctx, router);
  registerConsole(ctx);
  registerImport(ctx, router);
  ctx.log.info("Proxmox routes mounted at /plugin-api/pve");
}

export async function deactivate() {
  // Everything registered through ctx is disposed by core.
}
