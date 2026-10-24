import type { GuestType } from "../api";

export type PowerAction =
  "start" | "shutdown" | "stop" | "reboot" | "suspend" | "resume" | "reset";

/** The state a guest's power buttons depend on, from status/current. */
export interface GuestPowerState {
  type: GuestType;
  /** "running" or "stopped". */
  status?: string;
  /** QEMU's own run state: "paused" for a suspended VM. */
  qmpstatus?: string;
  template?: boolean;
  lock?: string;
}

/** Which power actions make sense right now, in toolbar order. */
export function availableActions(state: GuestPowerState): PowerAction[] {
  if (state.template) return [];
  const paused = state.qmpstatus === "paused" || state.status === "paused";
  if (paused) return ["resume", "stop"];
  if (state.status === "running") {
    return state.type === "qemu"
      ? ["shutdown", "reboot", "suspend", "stop", "reset"]
      : ["shutdown", "reboot", "stop"];
  }
  return ["start"];
}

/** Actions that can lose unsaved work in the guest, so they ask first. */
export const DESTRUCTIVE: ReadonlySet<PowerAction> = new Set(["stop", "reset"]);
