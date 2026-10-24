import { useTranslation, type TabProps } from "@termix-ssh/plugin-sdk/frontend";
import type { GuestType } from "../../api";
import { GuestConsole } from "./GuestConsole";

export const CONSOLE_TAB = "pve-console";

/** What a console tab is opened with, stored on the tab so it survives a reload. */
export interface ConsoleTabData {
  node: string;
  type: GuestType;
  vmid: number;
}

export function readConsoleTabData(
  data: Record<string, unknown> | undefined,
): ConsoleTabData | null {
  const vmid = Number(data?.vmid);
  if (
    typeof data?.node !== "string" ||
    (data.type !== "qemu" && data.type !== "lxc") ||
    !Number.isInteger(vmid) ||
    vmid <= 0
  ) {
    return null;
  }
  return { node: data.node, type: data.type, vmid };
}

/** A guest's console in a Termix tab of its own, like Proxmox's console window. */
export function ConsoleTab({ tab, host, isVisible }: TabProps) {
  const { t } = useTranslation();
  const data = readConsoleTabData(tab.data);
  const hostId = Number(host?.id);
  if (!data || !Number.isInteger(hostId) || hostId <= 0) {
    return (
      <p className="p-4 text-xs text-muted-foreground">{t("console.pick")}</p>
    );
  }
  return (
    <div className="h-full p-2">
      <GuestConsole
        hostId={hostId}
        node={data.node}
        type={data.type}
        vmid={data.vmid}
        fill
        autoConnect
        isVisible={isVisible}
      />
    </div>
  );
}
