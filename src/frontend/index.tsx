import { useEffect, type ComponentType } from "react";
import { Server } from "lucide-react";
import {
  useHosts,
  type TabProps,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { isPveHost, setApp } from "./api";
import { PveTab } from "./components/PveTab";

const TAB_ID = "pve";

function PveTabView(props: TabProps) {
  return <PveTab {...props} />;
}

export function activate(app: TermixApp): void {
  setApp(app);
  app.onDispose(() => setApp(null));

  app.registerTab(TAB_ID, PveTabView, {
    icon: Server,
    titleKey: "nav.title",
    hostless: true,
    singleton: true,
  });

  // The Proxmox tool sits in the rail's Tools band, and only once a host is
  // marked as a Proxmox node: it has nothing to show before that.
  let shown: boolean | null = null;
  let removeRailItem: (() => void) | null = null;
  const showRailItem = (visible: boolean) => {
    if (visible === shown) return;
    shown = visible;
    removeRailItem?.();
    removeRailItem = app.registerRailItem({
      id: TAB_ID,
      icon: Server,
      titleKey: "nav.title",
      kind: "tab",
      group: "tools",
      permission: "view",
      hidden: !visible,
    });
  };
  showRailItem(false);
  app.onDispose(() => removeRailItem?.());

  // Mounted once in the shell, so the rail follows the host list as it changes.
  function RailItemSync() {
    const { hosts, loaded } = useHosts();
    const any = hosts.some(isPveHost);
    useEffect(() => {
      if (loaded) showRailItem(any);
    }, [any, loaded]);
    return null;
  }
  app.registerSlotContribution("shell.overlay", {
    actionId: "pve.railSync",
    titleKey: "nav.title",
    kind: "component",
    component: RailItemSync as ComponentType<Record<string, unknown>>,
  });

  app.registerHostAction({
    id: "pve-open",
    titleKey: "nav.openHost",
    icon: Server,
    kind: "open",
    order: 55,
    tabType: TAB_ID,
    when: isPveHost,
  });
}
