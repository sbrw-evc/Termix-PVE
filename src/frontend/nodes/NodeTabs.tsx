import { useCallback, useEffect, useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  PanelSearch,
  ScrollArea,
  cn,
} from "@termix-ssh/plugin-sdk/ui";
import { RefreshCw } from "lucide-react";
import { app, pve, toCallError } from "../api";
import { formatBytes } from "../format";
import { useTasks } from "../tasks";

interface NodeTabProps {
  hostId: number;
  node: string;
  isVisible: boolean;
}

/** Loads one node endpoint while the tab is open. */
function useNodeData<T>(
  hostId: number,
  path: string[],
  params: Record<string, string | number> | undefined,
  isVisible: boolean,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([hostId, path, params]);
  const load = useCallback(async () => {
    try {
      setData(await pve<T>(hostId, "GET", path, params));
      setError(null);
    } catch (err) {
      setError(toCallError(err).message);
    }
    // key holds everything the call uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);
  return { data, error, load };
}

function State({ error, loading }: { error: string | null; loading: boolean }) {
  const { t } = useTranslation();
  if (error)
    return (
      <p role="alert" className="text-xs text-destructive">
        {error}
      </p>
    );
  if (loading)
    return <p className="text-xs text-muted-foreground">{t("app.loading")}</p>;
  return null;
}

// Services

interface NodeService {
  service: string;
  name?: string;
  desc?: string;
  state?: string;
  "active-state"?: string;
  "unit-state"?: string;
}

type ServiceAction = "start" | "stop" | "restart" | "reload";

export function serviceActions(service: NodeService): ServiceAction[] {
  const running =
    (service["active-state"] ?? service.state) === "active" ||
    service.state === "running";
  if (
    service["unit-state"] === "masked" ||
    service["unit-state"] === "not-found"
  )
    return [];
  return running ? ["reload", "restart", "stop"] : ["start"];
}

export function ServicesTab({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { track } = useTasks();
  const { data, error, load } = useNodeData<NodeService[]>(
    hostId,
    ["nodes", node, "services"],
    undefined,
    isVisible,
  );
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (service: NodeService, action: ServiceAction) => {
    if (action === "stop" || action === "restart") {
      const ok = await app().confirm({
        title: t(`nodes.services.confirm.${action}`, {
          name: service.name ?? service.service,
        }),
        description: t("nodes.services.confirm.description"),
        confirmLabel: t(`nodes.services.${action}`),
      });
      if (!ok) return;
    }
    setBusy(service.service);
    try {
      const upid = await pve(hostId, "POST", [
        "nodes",
        node,
        "services",
        service.service,
        action,
      ]);
      await track(
        upid,
        t("nodes.services.label", {
          action: t(`nodes.services.${action}`),
          name: service.service,
        }),
      );
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      setBusy(null);
      void load();
    }
  };

  return (
    <div className="flex flex-col">
      <State error={error} loading={!data && !error} />
      {data
        ?.slice()
        .sort((a, b) => a.service.localeCompare(b.service))
        .map((service) => {
          const state = service["active-state"] ?? service.state ?? "";
          return (
            <div
              key={service.service}
              className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
            >
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  state === "active" || state === "running"
                    ? "bg-emerald-500"
                    : "bg-muted-foreground/50",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {service.name ?? service.service}
                </div>
                {service.desc && (
                  <div className="truncate text-[11px] text-muted-foreground">
                    {service.desc}
                  </div>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground">{state}</span>
              {serviceActions(service).map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  disabled={busy !== null}
                  onClick={() => void run(service, action)}
                >
                  {t(`nodes.services.${action}`)}
                </Button>
              ))}
            </div>
          );
        })}
    </div>
  );
}

// Updates

interface AptUpdate {
  Package: string;
  OldVersion?: string;
  Version: string;
  Title?: string;
  Priority?: string;
  Origin?: string;
}

export function UpdatesTab({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { track } = useTasks();
  const { data, error, load } = useNodeData<AptUpdate[]>(
    hostId,
    ["nodes", node, "apt", "update"],
    undefined,
    isVisible,
  );
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const upid = await pve(hostId, "POST", ["nodes", node, "apt", "update"]);
      await track(upid, t("nodes.updates.refreshLabel", { node }));
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      setRefreshing(false);
      void load();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw
            className={cn("mr-1 size-3.5", refreshing && "animate-spin")}
          />
          {t("nodes.updates.refresh")}
        </Button>
        {data && (
          <span className="text-xs text-muted-foreground">
            {data.length
              ? t("nodes.updates.count", { count: data.length })
              : t("nodes.updates.none")}
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t("nodes.updates.installHint")}
      </p>
      <State error={error} loading={!data && !error} />
      {data
        ?.slice()
        .sort((a, b) => a.Package.localeCompare(b.Package))
        .map((u) => (
          <div
            key={u.Package}
            className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{u.Package}</div>
              {u.Title && (
                <div className="truncate text-[11px] text-muted-foreground">
                  {u.Title}
                </div>
              )}
            </div>
            <span className="font-mono text-[11px] text-muted-foreground">
              {u.OldVersion ? `${u.OldVersion} → ` : ""}
              {u.Version}
            </span>
          </div>
        ))}
    </div>
  );
}

// Disks

interface NodeDisk {
  devpath: string;
  model?: string;
  serial?: string;
  size?: number;
  type?: string;
  health?: string;
  used?: string;
  wearout?: number | string;
}

function SmartDialog({
  hostId,
  node,
  disk,
  onClose,
}: {
  hostId: number;
  node: string;
  disk: NodeDisk;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    pve<{
      health?: string;
      text?: string;
      attributes?: Array<{
        name: string;
        value: string | number;
        raw?: string;
      }>;
    }>(hostId, "GET", ["nodes", node, "disks", "smart"], {
      disk: disk.devpath,
    }).then(
      (smart) =>
        setText(
          smart?.text ??
            [
              `${t("nodes.disks.health")}: ${smart?.health ?? "-"}`,
              "",
              ...(smart?.attributes ?? []).map(
                (a) => `${a.name}: ${a.raw ?? a.value}`,
              ),
            ].join("\n"),
        ),
      (err) => setText(toCallError(err).message),
    );
  }, [hostId, node, disk.devpath, t]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t("nodes.disks.smartTitle", { disk: disk.devpath })}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-96 border border-border bg-muted/30">
          <pre className="p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {text ?? t("app.loading")}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function DisksTab({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const { data, error } = useNodeData<NodeDisk[]>(
    hostId,
    ["nodes", node, "disks", "list"],
    undefined,
    isVisible,
  );
  const [smart, setSmart] = useState<NodeDisk | null>(null);
  return (
    <div className="flex flex-col">
      <State error={error} loading={!data && !error} />
      {data?.map((disk) => {
        const healthy = !disk.health || /PASSED|OK/i.test(disk.health);
        return (
          <div
            key={disk.devpath}
            className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {disk.devpath}{" "}
                <span className="text-muted-foreground">{disk.model}</span>
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {[
                  formatBytes(disk.size),
                  disk.type?.toUpperCase(),
                  disk.used
                    ? t("nodes.disks.usedBy", { used: disk.used })
                    : t("nodes.disks.unused"),
                  disk.wearout !== undefined && disk.wearout !== "N/A"
                    ? t("nodes.disks.wearout", { value: disk.wearout })
                    : null,
                  disk.serial,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            {disk.health && (
              <Badge variant={healthy ? "secondary" : "destructive"}>
                {disk.health}
              </Badge>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2"
              onClick={() => setSmart(disk)}
            >
              {t("nodes.disks.smart")}
            </Button>
          </div>
        );
      })}
      {smart && (
        <SmartDialog
          hostId={hostId}
          node={node}
          disk={smart}
          onClose={() => setSmart(null)}
        />
      )}
    </div>
  );
}

// Log

/** /journal puts its start and end cursors around the lines; they aren't log. */
export function journalLines(data: string[] | null): string[] {
  return (data ?? []).filter((line) => !/^s=[0-9a-f]+;i=[0-9a-f]+;/.test(line));
}

export function LogTab({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const { data, error, load } = useNodeData<string[]>(
    hostId,
    ["nodes", node, "journal"],
    { lastentries: 500 },
    isVisible,
  );
  const [query, setQuery] = useState("");
  const lines = journalLines(data).filter(
    (line) => !query || line.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <PanelSearch
          value={query}
          onChange={setQuery}
          placeholder={t("nodes.log.search")}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void load()}
          title={t("app.refresh")}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <State error={error} loading={!data && !error} />
      {data && (
        <pre className="max-h-[32rem] overflow-auto border border-border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          {lines.join("\n") || t("nodes.log.empty")}
        </pre>
      )}
    </div>
  );
}
