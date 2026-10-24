import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  useHosts,
  useTranslation,
  type TabProps,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  EmptyState,
  PanelSearch,
  PanelShell,
  ScrollArea,
  Select2,
} from "@termix-ssh/plugin-sdk/ui";
import { RefreshCw, Server } from "lucide-react";
import {
  isPveHost,
  pve,
  toCallError,
  type GuestType,
  type PveCallError,
  type PveResource,
} from "../api";
import { buildResourceTree, guestCounts, isGuest } from "../tree";
import { errorText } from "../error-text";
import { TaskProvider } from "../tasks";
import { ResourceTree } from "./ResourceTree";
import { TasksPanel } from "./TasksPanel";
import { NodeView } from "./NodeView";
import { StorageView } from "../storage/StorageView";
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
  return null;
}

function ClusterView({
  hostId,
  isVisible,
  hostPicker,
}: {
  hostId: number;
  isVisible: boolean;
  hostPicker: ReactNode;
}) {
  const { t } = useTranslation();
  const [resources, setResources] = useState<PveResource[] | null>(null);
  const [error, setError] = useState<PveCallError | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResources(
        (await pve<PveResource[]>(hostId, "GET", ["cluster", "resources"])) ??
          [],
      );
      setError(null);
    } catch (err) {
      setError(toCallError(err));
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  useEffect(() => {
    setResources(null);
    setSelectedId(null);
  }, [hostId]);

  useEffect(() => {
    if (!isVisible) return;
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [isVisible, load]);

  const tree = useMemo(
    () => buildResourceTree(resources ?? [], query),
    [resources, query],
  );
  const selected = useMemo(
    () => resources?.find((r) => r.id === selectedId) ?? null,
    [resources, selectedId],
  );
  const counts = useMemo(() => guestCounts(resources ?? []), [resources]);

  return (
    <TaskProvider
      hostId={hostId}
      onFinished={() => {
        void load();
        // /cluster/resources catches up with a finished task a few seconds late.
        setTimeout(() => void load(), 3000);
      }}
    >
      <PanelShell
        icon={<Server className="size-4" />}
        title={t("nav.title")}
        status={
          resources
            ? t("app.status", {
                nodes: tree.length,
                running: counts.running,
                total: counts.total,
              })
            : undefined
        }
        scroll={false}
        leading={hostPicker}
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void load()}
            disabled={loading}
            title={t("app.refresh")}
          >
            <RefreshCw
              className={loading ? "size-3.5 animate-spin" : "size-3.5"}
            />
          </Button>
        }
        toolbar={
          <PanelSearch
            value={query}
            onChange={setQuery}
            placeholder={t("app.search")}
            fill
          />
        }
      >
        {error && !resources ? (
          // EmptyState shows its hint and action only at "guided" verbosity,
          // and the reason is what the user needs to fix this.
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <EmptyState icon={Server} title={t("app.loadFailed")} />
            <p
              role="alert"
              className="max-w-xl text-xs whitespace-pre-wrap text-muted-foreground"
            >
              {errorText(t, error)}
            </p>
            <Button size="sm" onClick={() => void load()} disabled={loading}>
              {t("app.retry")}
            </Button>
          </div>
        ) : !resources ? (
          <EmptyState icon={Server} title={t("app.loading")} />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {error && (
              <div className="border-b border-border bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                {t("app.refreshFailed", { message: errorText(t, error) })}
              </div>
            )}
            <div className="flex min-h-0 flex-1">
              <ScrollArea className="w-72 shrink-0 border-r border-border">
                <ResourceTree
                  tree={tree}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </ScrollArea>
              {/* A plain scroller: Radix ScrollArea lays its content out as a
                  table, which grows past the pane instead of wrapping. */}
              <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
                <Details
                  hostId={hostId}
                  selected={selected}
                  resources={resources}
                  isVisible={isVisible}
                />
              </div>
            </div>
            <TasksPanel hostId={hostId} isVisible={isVisible} />
          </div>
        )}
      </PanelShell>
    </TaskProvider>
  );
}

export function PveTab({ host, isVisible }: TabProps) {
  const { t } = useTranslation();
  const { hosts, loaded } = useHosts();
  const pveHosts = useMemo(
    () =>
      hosts
        .filter(isPveHost)
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [hosts],
  );
  const opened = host && isPveHost(host) ? Number(host.id) : null;
  const [chosen, setChosen] = useState<number | null>(opened);
  const hostId =
    chosen && pveHosts.some((h) => Number(h.id) === chosen)
      ? chosen
      : pveHosts[0]
        ? Number(pveHosts[0].id)
        : null;

  if (!hostId) {
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

  const picker =
    pveHosts.length > 1 ? (
      <Select2
        aria-label={t("app.pickHost")}
        value={String(hostId)}
        onChange={(e) => setChosen(Number(e.target.value))}
        className="h-7 max-w-48 border border-border bg-background px-2 text-xs outline-none"
      >
        {pveHosts.map((h) => (
          <option key={h.id} value={String(h.id)}>
            {h.name || h.ip}
          </option>
        ))}
      </Select2>
    ) : null;

  return (
    <ClusterView
      key={hostId}
      hostId={hostId}
      isVisible={isVisible}
      hostPicker={picker}
    />
  );
}
