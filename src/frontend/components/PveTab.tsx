import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useHosts,
  useShell,
  useTranslation,
  type ShellApi,
  type TabProps,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  EmptyState,
  PanelSearch,
  PanelShell,
  ScrollArea,
  Segmented,
} from "@termix-ssh/plugin-sdk/ui";
import { Download, RefreshCw, Server } from "lucide-react";
import {
  isPveHost,
  pve,
  toCallError,
  type GuestType,
  type PveCallError,
  type PveResource,
} from "../api";
import {
  DATACENTER,
  guestCounts,
  hostTree,
  isGuest,
  parseSelection,
  type TreeView,
} from "../tree";
import { setTreeState, useTreeState, type ClusterState } from "../treeStore";
import { TREE_PANEL } from "./TreePanel";

import { ImportDialog } from "./ImportDialog";

import { errorText } from "../error-text";
import { TaskProvider } from "../tasks";
import { ResourceTree } from "./ResourceTree";
import { DatacenterView } from "../datacenter/DatacenterView";
import { TasksPanel } from "./TasksPanel";
import { NodeView } from "./NodeView";
import { StorageView } from "../storage/StorageView";
import { PoolView, SdnView } from "./GroupViews";
import { GuestView } from "../guests/GuestView";

const REFRESH_MS = 10000;

function Details({
  hostId,
  selected,
  resources,
  isVisible,
}: {
  hostId: number;
  selected: PveResource | null;
  resources: PveResource[];
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  if (!selected) {
    return <EmptyState icon={Server} title={t("app.pickResource")} />;
  }
  if (selected.type === "node") {
    return (
      <NodeView
        hostId={hostId}
        node={selected}
        resources={resources}
        isVisible={isVisible}
      />
    );
  }
  if (isGuest(selected) && selected.node && selected.vmid !== undefined) {
    return (
      <GuestView
        hostId={hostId}
        guest={{
          ...selected,
          type: selected.type as GuestType,
          node: selected.node,
          vmid: selected.vmid,
        }}
        isVisible={isVisible}
      />
    );
  }
  if (selected.type === "storage") {
    return (
      <StorageView hostId={hostId} storage={selected} isVisible={isVisible} />
    );
  }
  if (selected.type === "pool")
    return <PoolView pool={selected} resources={resources} />;
  if (selected.type === "sdn") return <SdnView zone={selected} />;
  return null;
}

/** /cluster/resources of every Proxmox host, kept fresh while the tab shows. */
function useClusters(hostIds: number[], isVisible: boolean) {
  const [state, setState] = useState<Record<number, ClusterState>>({});
  const [loading, setLoading] = useState(false);
  const key = hostIds.join(",");

  const loadOne = useCallback(async (hostId: number) => {
    try {
      const resources =
        (await pve<PveResource[]>(hostId, "GET", ["cluster", "resources"])) ??
        [];
      setState((s) => ({ ...s, [hostId]: { resources, error: null } }));
    } catch (err) {
      // Keep what was loaded before, so a hiccup doesn't empty the tree.
      setState((s) => ({
        ...s,
        [hostId]: {
          resources: s[hostId]?.resources ?? null,
          error: toCallError(err),
        },
      }));
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all(hostIds.map(loadOne));
    setLoading(false);
    // key stands for hostIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadOne]);

  useEffect(() => {
    if (!isVisible) return;
    void loadAll();
    const timer = setInterval(() => void loadAll(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [isVisible, loadAll]);

  return { state, loading, loadAll, loadOne };
}

/**
 * Every Proxmox host in one tree, each under a Datacenter row of its own, as
 * Proxmox would show separate clusters. What is selected decides which host
 * the details, tasks and import work on.
 */
function ClustersView({
  hosts,
  initialHostId,
  isVisible,
}: {
  hosts: Array<{ id: number; name: string }>;
  initialHostId: number;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const hostIds = useMemo(() => hosts.map((h) => h.id), [hosts]);
  const { state, loading, loadAll, loadOne } = useClusters(hostIds, isVisible);
  const { query, selection, view, inSidebar } = useTreeState();
  const setQuery = (next: string) => setTreeState({ query: next });
  const setSelection = (next: string | null) =>
    setTreeState({ selection: next });
  const [importing, setImporting] = useState(false);

  // The sidebar tree draws from what this tab loads.
  useEffect(() => {
    setTreeState({ hosts, clusters: state });
  }, [hosts, state]);

  const picked = parseSelection(selection);
  // The host everything works on: the selection's, or the one the tab opened with.
  const activeId =
    picked && hostIds.includes(picked.hostId)
      ? picked.hostId
      : hostIds.includes(initialHostId)
        ? initialHostId
        : hostIds[0];
  const active = state[activeId];
  const activeName = hosts.find((h) => h.id === activeId)?.name ?? "";

  const tree = useMemo(
    () =>
      hosts
        .filter((h) => state[h.id]?.resources)
        .map((h) =>
          hostTree(h.id, h.name, state[h.id].resources!, view, query),
        ),
    [hosts, state, view, query],
  );
  const all = useMemo(
    () => hosts.flatMap((h) => state[h.id]?.resources ?? []),
    [hosts, state],
  );
  const counts = useMemo(() => guestCounts(all), [all]);
  const nodeCount = all.filter((r) => r.type === "node").length;
  const failed = hosts.filter((h) => state[h.id]?.error);
  const loaded = hosts.some((h) => state[h.id]?.resources);
  const selected =
    picked && picked.hostId === activeId && picked.id !== DATACENTER
      ? (active?.resources?.find((r) => r.id === picked.id) ?? null)
      : null;

  return (
    <TaskProvider
      key={activeId}
      hostId={activeId}
      onFinished={() => {
        void loadOne(activeId);
        // /cluster/resources catches up with a finished task a few seconds late.
        setTimeout(() => void loadOne(activeId), 3000);
      }}
    >
      <PanelShell
        icon={<Server className="size-4" />}
        title={t("nav.title")}
        status={
          loaded
            ? t("app.status", {
                nodes: nodeCount,
                running: counts.running,
                total: counts.total,
              })
            : undefined
        }
        scroll={false}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setImporting(true)}
              title={t("import.openFor", { name: activeName })}
            >
              <Download className="mr-1 size-3.5" />
              {t("import.open")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void loadAll()}
              disabled={loading}
              title={t("app.refresh")}
            >
              <RefreshCw
                className={loading ? "size-3.5 animate-spin" : "size-3.5"}
              />
            </Button>
          </>
        }
        toolbar={
          inSidebar ? undefined : (
            <div className="flex w-full items-center gap-2">
              <PanelSearch
                value={query}
                onChange={setQuery}
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
          )
        }
      >
        {!loaded && failed.length === hosts.length ? (
          // EmptyState shows its hint and action only at "guided" verbosity,
          // and the reason is what the user needs to fix this.
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <EmptyState icon={Server} title={t("app.loadFailed")} />
            {failed.map((h) => (
              <p
                key={h.id}
                role="alert"
                className="max-w-xl text-xs whitespace-pre-wrap text-muted-foreground"
              >
                {hosts.length > 1 ? `${h.name}: ` : ""}
                {errorText(t, state[h.id].error!)}
              </p>
            ))}
            <Button size="sm" onClick={() => void loadAll()} disabled={loading}>
              {t("app.retry")}
            </Button>
          </div>
        ) : !loaded ? (
          <EmptyState icon={Server} title={t("app.loading")} />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {failed.map((h) => (
              <div
                key={h.id}
                className="border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
              >
                {t("app.hostFailed", {
                  name: h.name,
                  message: errorText(t, state[h.id].error!),
                })}
              </div>
            ))}
            <div className="flex min-h-0 flex-1">
              {/* In the left sidebar instead, while that panel shows. */}
              {!inSidebar && (
                <ScrollArea className="w-72 shrink-0 border-r border-border">
                  <ResourceTree
                    tree={tree}
                    selectedId={selection}
                    onSelect={setSelection}
                  />
                </ScrollArea>
              )}
              {/* A plain scroller: Radix ScrollArea lays its content out as a
                  table, which grows past the pane instead of wrapping. */}
              <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
                {picked?.id === DATACENTER && active?.resources ? (
                  <DatacenterView
                    key={activeId}
                    hostId={activeId}
                    title={t("tree.datacenterOf", { name: activeName })}
                    resources={active.resources}
                    isVisible={isVisible}
                  />
                ) : (
                  <Details
                    key={activeId}
                    hostId={activeId}
                    selected={selected}
                    resources={active?.resources ?? []}
                    isVisible={isVisible}
                  />
                )}
              </div>
            </div>
            <TasksPanel
              key={activeId}
              hostId={activeId}
              hostName={hosts.length > 1 ? activeName : undefined}
              isVisible={isVisible}
            />
            {importing && (
              <ImportDialog
                hostId={activeId}
                onClose={() => setImporting(false)}
              />
            )}
          </div>
        )}
      </PanelShell>
    </TaskProvider>
  );
}

/**
 * Shows the tree in the left sidebar while the Proxmox tab is on screen, and
 * gives the sidebar back to what it showed before when the tab is left. Phones
 * keep the tree in the tab: their sidebar is a drawer over everything.
 */
function useSidebarTree(isVisible: boolean, shell: ShellApi) {
  const live = useShell();
  const mobile = live?.env.isMobile ?? false;
  const leftView = live?.regions.left.view;
  const leftRef = useRef(leftView);
  leftRef.current = leftView;

  useEffect(() => {
    if (mobile || !isVisible) return;
    const previous = leftRef.current;
    if (previous !== TREE_PANEL) shell.openRailView(TREE_PANEL);
    // Hidden or closed: only undo our own switch, not one the user made since.
    return () => {
      if (leftRef.current !== TREE_PANEL) return;
      if (previous && previous !== TREE_PANEL) shell.openRailView(previous);
      else shell.closeRailView(TREE_PANEL);
    };
  }, [isVisible, mobile, shell]);
}

export function PveTab({ host, isVisible, shell }: TabProps) {
  const { t } = useTranslation();
  useSidebarTree(isVisible, shell);
  const { hosts, loaded } = useHosts();
  const pveHosts = useMemo(
    () =>
      hosts
        .filter(isPveHost)
        .map((h) => ({ id: Number(h.id), name: String(h.name || h.ip) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [hosts],
  );
  const opened = host && isPveHost(host) ? Number(host.id) : null;

  if (!pveHosts.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <EmptyState
          icon={Server}
          title={loaded ? t("app.noHosts") : t("app.loading")}
        />
        {loaded && (
          <p className="max-w-md text-xs text-muted-foreground">
            {t("app.noHostsHint")}
          </p>
        )}
      </div>
    );
  }

  return (
    <ClustersView
      hosts={pveHosts}
      initialHostId={opened ?? pveHosts[0].id}
      isVisible={isVisible}
    />
  );
}
