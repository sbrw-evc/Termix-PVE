import { useEffect, useState } from "react";
import { pve } from "../api";
import { guestPath, type GuestRef } from "./useGuestConfig";

interface LxcInterface {
  name: string;
  inet?: string;
  inet6?: string;
}

interface AgentInterface {
  name: string;
  "ip-addresses"?: Array<{ "ip-address": string; "ip-address-type": string }>;
}

const skip = (ip: string) =>
  ip.startsWith("127.") || ip === "::1" || ip.toLowerCase().startsWith("fe80:");

/** Addresses a running guest reports, without loopback and link-local ones. */
export function guestIps(type: GuestRef["type"], data: unknown): string[] {
  const ips: string[] = [];
  if (type === "lxc") {
    for (const iface of (data as LxcInterface[]) ?? []) {
      if (iface.name === "lo") continue;
      for (const cidr of [iface.inet, iface.inet6]) {
        const ip = cidr?.split("/")[0];
        if (ip && !skip(ip)) ips.push(ip);
      }
    }
  } else {
    const result = (data as { result?: AgentInterface[] })?.result ?? [];
    for (const iface of result) {
      if (iface.name === "lo") continue;
      for (const addr of iface["ip-addresses"] ?? []) {
        if (!skip(addr["ip-address"])) ips.push(addr["ip-address"]);
      }
    }
  }
  return ips;
}

/**
 * A running guest's addresses: containers from /interfaces, VMs from the
 * guest agent, which may not be installed. Null until known.
 */
export function useGuestIps(
  guest: GuestRef,
  running: boolean,
): string[] | null {
  const [ips, setIps] = useState<string[] | null>(null);
  useEffect(() => {
    if (!running) {
      setIps(null);
      return;
    }
    let cancelled = false;
    const path =
      guest.type === "lxc"
        ? guestPath(guest, "interfaces")
        : guestPath(guest, "agent", "network-get-interfaces");
    pve(guest.hostId, "GET", path).then(
      (data) => !cancelled && setIps(guestIps(guest.type, data)),
      () => !cancelled && setIps(null),
    );
    return () => {
      cancelled = true;
    };
    // guest fields are what the path uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest.hostId, guest.node, guest.type, guest.vmid, running]);
  return ips;
}
