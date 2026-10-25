import { useEffect, useMemo } from "react";
import {
  useShell,
  useTranslation,
  type PanelProps,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  EmptyState,
  PanelSearch,
  PanelShell,
  Segmented,
} from "@termix-ssh/plugin-sdk/ui";
import { Server } from "lucide-react";
import { hostTree, type TreeView } from "../tree";
import { setTreeState, useTreeState } from "../treeStore";
import { ResourceTree } from "./ResourceTree";

export const TREE_PANEL = "pve-tree";

/**
 * The Proxmox tree in the left sidebar, where the host list sits otherwise.
 * The Proxmox tab loads the clusters; picking a row here shows it there.
 */
export function TreePanel({ active, placement }: PanelProps) {
  const { t } = useTranslation();
  const { hosts, clusters, query, selection, view } = useTreeState();

  // While this is on screen, the tab leaves its own tree out. A collapsed
  // sidebar keeps the panel active, so its open state counts too.
  const leftOpen = useShell()?.regions.left.open ?? true;
  useEffect(() => {
    const shown = active && leftOpen && placement !== "tab";
    setTreeState({ inSidebar: shown });
    return () => setTreeState({ inSidebar: false });
  }, [active, leftOpen, placement]);

  const tree = useMemo(
    () =>
      hosts
        .filter((h) => clusters[h.id]?.resources)
        .map((h) =>
          hostTree(h.id, h.name, clusters[h.id].resources!, view, query),
        ),
    [hosts, clusters, view, query],
  );

  return (
    <PanelShell
      icon={<Server className="size-4" />}
      title={t("nav.title")}
      scroll
      toolbar={
        <div className="flex w-full flex-col gap-2">
          <PanelSearch
            value={query}
            onChange={(next) => setTreeState({ query: next })}
            placeholder={t("app.search")}
            fill
          />
          <Segmented
            value={view}
            onChange={(next) => setTreeState({ view: next as TreeView })}
            options={[
              { value: "folder", label: t("tree.views.folder") },
              { value: "server", label: t("tree.views.server") },
            ]}
          />
        </div>
      }
    >
      {tree.length === 0 ? (
        <EmptyState
          icon={Server}
          title={hosts.length ? t("app.loading") : t("tree.openTab")}
        />
      ) : (
        <ResourceTree
          tree={tree}
          selectedId={selection}
          onSelect={(id) => setTreeState({ selection: id })}
        />
      )}
    </PanelShell>
  );
}
