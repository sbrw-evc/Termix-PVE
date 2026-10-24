import { useCallback, useEffect, useState } from "react";
import { pve, toCallError, type GuestType, type PveParams } from "../api";
import { pendingKeys, type GuestConfig } from "./config";

export interface GuestRef {
  hostId: number;
  node: string;
  type: GuestType;
  vmid: number;
}

export function guestPath(guest: GuestRef, ...rest: Array<string | number>) {
  return ["nodes", guest.node, guest.type, guest.vmid, ...rest];
}

/**
 * A guest's config with the keys PVE will only apply on the next restart.
 * reload runs after every change the tab makes.
 */
export function useGuestConfig(guest: GuestRef, isVisible: boolean) {
  const [config, setConfig] = useState<GuestConfig | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [cfg, pend] = await Promise.all([
        pve<GuestConfig>(guest.hostId, "GET", guestPath(guest, "config")),
        pve<Array<{ key: string; pending?: unknown; delete?: number }>>(
          guest.hostId,
          "GET",
          guestPath(guest, "pending"),
        ).catch(() => []),
      ]);
      setConfig(cfg ?? {});
      setPending(pendingKeys(pend ?? []));
      setError(null);
    } catch (err) {
      setError(toCallError(err).message);
    }
    // guest fields are what the path uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest.hostId, guest.node, guest.type, guest.vmid]);

  useEffect(() => {
    if (isVisible) void reload();
  }, [reload, isVisible]);

  return { config, pending, error, reload };
}

/**
 * Changes config keys. Empty strings and nulls are deleted. The digest makes
 * PVE refuse the change if someone else changed the config since it loaded.
 */
export function setConfig(
  guest: GuestRef,
  changes: Record<string, string | number | boolean | null>,
  digest?: string,
): Promise<unknown> {
  const params: PveParams = {};
  const remove: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") remove.push(key);
    else params[key] = value;
  }
  if (remove.length) params.delete = remove.join(",");
  if (digest) params.digest = digest;
  return pve(guest.hostId, "PUT", guestPath(guest, "config"), params);
}
