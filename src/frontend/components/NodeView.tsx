import { useEffect, useState } from "react";
import {
  useHosts,
  useTabs,
  useTranslation,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  GroupHeading,
  Segmented,
} from "@termix-ssh/plugin-sdk/ui";
import { Box, Monitor, Power, SquareTerminal } from "lucide-react";
import { pve, type PveResource } from "../api";
import { formatBytes, formatUptime, percent } from "../format";
import { isGuest } from "../tree";
import { useTasks } from "../tasks";
import { Fact, Usage } from "./Usage";
import { RrdCharts } from "./RrdCharts";
import { Field, FormDialog, TextInput } from "./forms";
import { CreateCtDialog, CreateVmDialog } from "../guests/CreateDialogs";
import { DisksTab, LogTab, ServicesTab, UpdatesTab } from "../nodes/NodeTabs";
import { NetworkTab } from "../nodes/NetworkTab";
import { CephTab } from "../nodes/CephTab";
import { FirewallPanel } from "../datacenter/FirewallPanel";
import { SystemTab } from "../nodes/SystemTab";
import { RepositoriesSection } from "../nodes/RepositoriesSection";
import { DiskStorage, type DiskStorageKind } from "../nodes/DiskStorage";
import { TaskHistoryTab } from "../nodes/TaskHistoryTab";

interface NodeStatus {
  pveversion?: string;
  kversion?: string;
  loadavg?: string[];
  cpuinfo?: { model?: string; cpus?: number; sockets?: number };
  uptime?: number;
  swap?: { used?: number; total?: number };
}

type NodeTab =
  | "summary"
  | "network"
  | "system"
  | "services"
  | "updates"
  | "firewall"
  | "disks"
  | "ceph"
  | "tasks"
  | "log";
/** In the order of Proxmox's node menu. */
const TABS: NodeTab[] = [
  "summary",
  "network",
  "system",
  "services",
  "updates",
  "firewall",
  "disks",
  "ceph",
  "tasks",
  "log",
];
type UpdatesView = "packages" | "repositories";
type DisksView = "disks" | DiskStorageKind;
const DISK_VIEWS: DisksView[] = ["disks", "lvm", "lvmthin", "directory", "zfs"];

/**
 * Rebooting or shutting a node down stops every guest on it, and may take
 * Termix down with it, so it asks for the node's name.
 */
function NodePowerDialog({
  hostId,
  node,
  command,
  running,
  onClose,
}: {
  hostId: number;
  node: string;
  command: "reboot" | "shutdown";
  running: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [typed, setTyped] = useState("");
  return (
    <FormDialog
      title={t(`nodes.power.${command}.title`, { node })}
      submitLabel={t(`nodes.power.${command}.submit`)}
      destructive
      canSubmit={typed === node}
      onClose={onClose}
      onSubmit={async () => {
        const result = await pve(hostId, "POST", ["nodes", node, "status"], {
          command,
        });
        void track(result, t(`nodes.power.${command}.label`, { node }));
      }}
    >
      {() => (
        <>
          <p className="text-xs text-muted-foreground">
            {t(`nodes.power.${command}.warning`, { count: running })}
          </p>
          <p className="text-xs text-destructive">
            {t("nodes.power.termixWarning")}
          </p>
          <Field label={t("nodes.power.typeName", { node })}>
            <TextInput value={typed} onChange={setTyped} placeholder={node} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

export function NodeView({
  hostId,
  node,
  resources,
  isVisible,
}: {
  hostId: number;
  node: PveResource;
  resources: PveResource[];
  isVisible: boolean;
}) {
  const { t, language } = useTranslation();
  const name = node.node ?? node.id;
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [dialog, setDialog] = useState<
    "vm" | "ct" | "reboot" | "shutdown" | null
  >(null);
  const [tab, setTab] = useState<NodeTab>("summary");
  const [updatesView, setUpdatesView] = useState<UpdatesView>("packages");
  const [disksView, setDisksView] = useState<DisksView>("disks");
  const online = node.status === "online";
  const tabs = useTabs();
  // The node's shell is the Termix host's own SSH terminal.
  const termixHost = useHosts().hosts.find((h) => Number(h.id) === hostId);

  useEffect(() => {
    if (!isVisible || !online) return;
    let cancelled = false;
    pve<NodeStatus>(hostId, "GET", ["nodes", name, "status"]).then(
      (data) => !cancelled && setStatus(data),
      () => !cancelled && setStatus(null),
    );
    return () => {
      cancelled = true;
    };
  }, [hostId, name, online, isVisible, node.uptime]);

  const guests = resources.filter(
    (r) => isGuest(r) && r.node === name && !r.template,
  );
  const running = guests.filter((g) => g.status === "running").length;
  const tabProps = { hostId, node: name, isVisible };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{name}</h2>
        <Badge variant="outline">{t("types.node")}</Badge>
        {node.status && (
          <Badge variant="secondary">
            {t(`states.${node.status}`, { defaultValue: node.status })}
          </Badge>
        )}
        <div className="ml-auto flex flex-wrap gap-1">
          {termixHost && (
            <Button
              size="sm"
              variant="outline"
              title={t("nodes.shellHint")}
              onClick={() => tabs.connectHost(termixHost)}
            >
              <SquareTerminal className="mr-1 size-3.5" />
              {t("nodes.shell")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!online}
            onClick={() => setDialog("vm")}
          >
            <Monitor className="mr-1 size-3.5" />
            {t("guests.create.vmButton")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!online}
            onClick={() => setDialog("ct")}
          >
            <Box className="mr-1 size-3.5" />
            {t("guests.create.ctButton")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={!online}
                aria-label={t("nodes.power.menu")}
              >
                <Power className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDialog("reboot")}>
                {t("nodes.power.reboot.menu")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDialog("shutdown")}
              >
                {t("nodes.power.shutdown.menu")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {online && (
        <Segmented
          className="max-w-full overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap"
          value={tab}
          onChange={(v) => setTab(v as NodeTab)}
          options={TABS.map((value) => ({
            value,
            label: t(`nodes.tabs.${value}`),
          }))}
        />
      )}

      {tab === "summary" && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
            <Usage
              label={t("usage.cpu")}
              value={node.cpu !== undefined ? node.cpu * 100 : null}
              detail={
                node.maxcpu ? t("usage.cores", { count: node.maxcpu }) : "-"
              }
            />
            <Usage
              label={t("usage.memory")}
              value={percent(node.mem, node.maxmem)}
              detail={`${formatBytes(node.mem)} / ${formatBytes(node.maxmem)}`}
            />
            <Usage
              label={t("usage.rootDisk")}
              value={percent(node.disk, node.maxdisk)}
              detail={`${formatBytes(node.disk)} / ${formatBytes(node.maxdisk)}`}
            />
            {!!status?.swap?.total && (
              <Usage
                label={t("usage.swap")}
                value={percent(status.swap.used, status.swap.total)}
                detail={`${formatBytes(status.swap.used)} / ${formatBytes(status.swap.total)}`}
              />
            )}
          </div>

          <div>
            <GroupHeading title={t("summary.title")} />
            <Fact label={t("summary.uptime")}>
              {formatUptime(status?.uptime ?? node.uptime, language)}
            </Fact>
            <Fact label={t("summary.guests")}>
              {t("summary.guestsRunning", { running, total: guests.length })}
            </Fact>
            {status?.cpuinfo?.model && (
              <Fact label={t("summary.cpuModel")}>
                {status.cpuinfo.model}
                {status.cpuinfo.sockets
                  ? ` (${status.cpuinfo.sockets} × ${t("summary.sockets")})`
                  : ""}
              </Fact>
            )}
            {status?.loadavg && (
              <Fact label={t("summary.load")}>{status.loadavg.join(" ")}</Fact>
            )}
            {status?.pveversion && (
              <Fact label={t("summary.pveVersion")}>{status.pveversion}</Fact>
            )}
            {status?.kversion && (
              <Fact label={t("summary.kernel")}>{status.kversion}</Fact>
            )}
          </div>

          {online && (
            <RrdCharts hostId={hostId} node={name} isVisible={isVisible} />
          )}
        </>
      )}
      {tab === "network" && <NetworkTab {...tabProps} />}
      {tab === "system" && <SystemTab {...tabProps} />}
      {tab === "services" && <ServicesTab {...tabProps} />}
      {tab === "updates" && (
        <>
          <Segmented
            className="max-w-full self-start overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap"
            value={updatesView}
            onChange={(value) => setUpdatesView(value as UpdatesView)}
            options={(["packages", "repositories"] as const).map((value) => ({
              value,
              label: t(`nodes.updates.views.${value}`),
            }))}
          />
          {updatesView === "packages" ? (
            <UpdatesTab {...tabProps} />
          ) : (
            <RepositoriesSection {...tabProps} />
          )}
        </>
      )}
      {tab === "firewall" && (
        <FirewallPanel
          hostId={hostId}
          base={["nodes", name, "firewall"]}
          scope="node"
          isVisible={isVisible}
        />
      )}
      {tab === "ceph" && <CephTab {...tabProps} />}
      {tab === "disks" && (
        <>
          <Segmented
            className="max-w-full self-start overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap"
            value={disksView}
            onChange={(value) => setDisksView(value as DisksView)}
            options={DISK_VIEWS.map((value) => ({
              value,
              label: t(`nodes.disks.views.${value}`),
            }))}
          />
          {disksView === "disks" ? (
            <DisksTab {...tabProps} />
          ) : (
            <DiskStorage key={disksView} kind={disksView} {...tabProps} />
          )}
        </>
      )}
      {tab === "tasks" && <TaskHistoryTab {...tabProps} />}
      {tab === "log" && <LogTab {...tabProps} />}

      {dialog === "vm" && (
        <CreateVmDialog
          hostId={hostId}
          node={name}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "ct" && (
        <CreateCtDialog
          hostId={hostId}
          node={name}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog === "reboot" || dialog === "shutdown") && (
        <NodePowerDialog
          hostId={hostId}
          node={name}
          command={dialog}
          running={running}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
