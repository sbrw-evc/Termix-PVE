import { useEffect, useState } from "react";
import { pve } from "../api";

export interface PveStorage {
  storage: string;
  type: string;
  /** Comma-separated: images, rootdir, iso, vztmpl, backup, snippets. */
  content: string;
  active?: number;
  enabled?: number;
  avail?: number;
  total?: number;
  shared?: number;
}

export interface PveVolume {
  volid: string;
  size?: number;
  format?: string;
}

export function storageHolds(storage: PveStorage, content: string): boolean {
  return storage.content
    .split(",")
    .map((c) => c.trim())
    .includes(content);
}

/** A volume id's file name: "local:iso/debian.iso" shows as "debian.iso". */
export function volumeName(volid: string): string {
  const afterStorage = volid.slice(volid.indexOf(":") + 1);
  return afterStorage.slice(afterStorage.lastIndexOf("/") + 1);
}

/** Loads something for the dialog, again whenever a key changes. */
export function useLoad<T>(
  load: () => Promise<T>,
  keys: unknown[],
): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    load().then(
      (value) => {
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      },
      (err: Error) => {
        if (!cancelled) setError(err.message);
      },
    );
    return () => {
      cancelled = true;
    };
    // The caller lists what load depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, keys);
  return { data, error };
}

export async function nextVmid(hostId: number): Promise<number> {
  return Number(
    await pve<string | number>(hostId, "GET", ["cluster", "nextid"]),
  );
}

export async function listNodes(hostId: number): Promise<string[]> {
  const nodes =
    (await pve<Array<{ node: string; status?: string }>>(hostId, "GET", [
      "nodes",
    ])) ?? [];
  return nodes
    .filter((n) => n.status !== "offline")
    .map((n) => n.node)
    .sort();
}

export async function listStorages(
  hostId: number,
  node: string,
  content: string,
): Promise<PveStorage[]> {
  const all =
    (await pve<PveStorage[]>(hostId, "GET", ["nodes", node, "storage"], {
      content,
      enabled: 1,
    })) ?? [];
  return all
    .filter((s) => storageHolds(s, content) && s.active !== 0)
    .sort((a, b) => a.storage.localeCompare(b.storage));
}

/** Every volume of one content type across the node's storages. */
export async function listVolumes(
  hostId: number,
  node: string,
  content: "iso" | "vztmpl",
): Promise<PveVolume[]> {
  const storages = await listStorages(hostId, node, content);
  const lists = await Promise.all(
    storages.map((s) =>
      pve<PveVolume[]>(
        hostId,
        "GET",
        ["nodes", node, "storage", s.storage, "content"],
        {
          content,
        },
      ).catch(() => [] as PveVolume[]),
    ),
  );
  return lists
    .flat()
    .filter(Boolean)
    .sort((a, b) => volumeName(a.volid).localeCompare(volumeName(b.volid)));
}

export async function listBridges(
  hostId: number,
  node: string,
): Promise<string[]> {
  const ifaces =
    (await pve<Array<{ iface: string }>>(
      hostId,
      "GET",
      ["nodes", node, "network"],
      {
        type: "any_bridge",
      },
    )) ?? [];
  return ifaces.map((i) => i.iface).sort();
}
