import { useEffect, type ComponentType } from "react";
import { Server, SquareTerminal } from "lucide-react";
import {
  useHosts,
  type TabProps,
  type TermixApp,
} from "@termix-ssh/plugin-sdk/frontend";
import { isPveHost, setApp } from "./api";
import { PveTab } from "./components/PveTab";
import { TREE_PANEL, TreePanel } from "./components/TreePanel";
import { CONSOLE_TAB, ConsoleTab } from "./guests/console/ConsoleTab";

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

  // The tree, in the left sidebar while the Proxmox tab is on screen.
  app.registerPanel(TREE_PANEL, TreePanel, { keepMounted: true });

  // Opened from a guest's Console button, bound to the node's Termix host.
  app.registerTab(CONSOLE_TAB, ConsoleTab, {
    icon: SquareTerminal,
    titleKey: "console.tabTitle",
    requiresHost: true,
    session: true,
    ownBackground: true,
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

  // The sidebar tree has no rail button of its own (the Proxmox tab opens it),
  // but the sidebar takes its header title from a rail item.
  app.onDispose(
    app.registerRailItem({
      id: TREE_PANEL,
      icon: Server,
      titleKey: "nav.title",
      kind: "panel",
      hideable: false,
      permission: "view",
      hidden: true,
    }),
  );

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

  // Tools is the way in. A node's own shortcut lives in its right-click menu,
  // not as another button on the host row.
  app.registerHostAction({
    id: "pve-open",
    titleKey: "nav.openHost",
    icon: Server,
    kind: "open",
    order: 55,
    tabType: TAB_ID,
    tray: false,
    when: isPveHost,
  });
  app.registerHostContextMenuItem({
    id: "pve-open",
    titleKey: "nav.openHost",
    icon: Server,
    when: isPveHost,
    run: (host, shell) => shell.openTab(host, TAB_ID),
  });
}
