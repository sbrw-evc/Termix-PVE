import { useCallback, useEffect, useState } from "react";
import {
  useHosts,
  useTabs,
  useToast,
  useTranslation,
} from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  GroupHeading,
  Segmented,
} from "@termix-ssh/plugin-sdk/ui";
import {
  Copy,
  LayoutTemplate,
  MoreHorizontal,
  MoveRight,
  Pause,
  Play,
  Power,
  RotateCcw,
  Square,
  SquareTerminal,
  MonitorPlay,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  app,
  pve,
  toCallError,
  type GuestType,
  type PveResource,
} from "../api";
import { formatBytes, formatUptime, percent } from "../format";
import { guestLabel } from "../tree";
import { useTasks } from "../tasks";
import { Fact, Usage } from "../components/Usage";
import { RrdCharts } from "../components/RrdCharts";
import { availableActions, DESTRUCTIVE, type PowerAction } from "./actions";
import { CloneDialog, DeleteDialog, MigrateDialog } from "./GuestDialogs";
import { HardwareTab } from "./hardware/HardwareTab";
import { OptionsTab } from "./options/OptionsTab";
import { CloudInitTab } from "./options/CloudInitTab";
import { SnapshotsTab } from "./SnapshotsTab";
import { BackupTab } from "./BackupTab";
import { FirewallPanel } from "../datacenter/FirewallPanel";
import { useGuestIps } from "./ips";
import { CONSOLE_TAB, type ConsoleTabData } from "./console/ConsoleTab";
import { ImportDialog } from "../components/ImportDialog";

type GuestTab =
  | "summary"
  | "hardware"
  | "options"
  | "cloudinit"
  | "backup"
  | "snapshots"
  | "firewall";

/** Cloud-init only exists for VMs; templates can't have snapshots. In Proxmox's order. */
function tabsFor(guest: { type: GuestType; template?: number }): GuestTab[] {
  return [
    "summary",
    "hardware",
    "options",
    ...(guest.type === "qemu" ? (["cloudinit"] as const) : []),
    "backup",
    ...(guest.template ? [] : (["snapshots"] as const)),
    "firewall",
  ];
}

const ICONS: Record<PowerAction, LucideIcon> = {
  start: Play,
  shutdown: Power,
  stop: Square,
  reboot: RotateCcw,
  suspend: Pause,
  resume: Play,
  reset: Zap,
};

interface GuestStatus {
  status?: string;
  qmpstatus?: string;
  lock?: string;
  uptime?: number;
  pid?: number;
  ha?: { managed?: number; state?: string };
  /** Containers only. */
  swap?: number;
  maxswap?: number;
}

type Guest = PveResource & { type: GuestType; node: string; vmid: number };

export function GuestView({
  hostId,
  guest,
  isVisible,
}: {
  hostId: number;
  guest: Guest;
  isVisible: boolean;
}) {
  const { t, language } = useTranslation();
  const { track } = useTasks();
  const toast = useToast();
  const [status, setStatus] = useState<GuestStatus | null>(null);
  const [tab, setTab] = useState<GuestTab>("summary");
  const ref = { hostId, node: guest.node, type: guest.type, vmid: guest.vmid };
  const ips = useGuestIps(
    ref,
    (status?.status ?? guest.status) === "running" && isVisible,
  );
  const [dialog, setDialog] = useState<"clone" | "migrate" | "delete" | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const base = ["nodes", guest.node, guest.type, guest.vmid];
  const tabs = useTabs();
  const { hosts } = useHosts();
  const termixHost = hosts.find((h) => Number(h.id) === hostId);
  const [offerImport, setOfferImport] = useState(false);
  // A host just imported from here, opened once the host list has it.
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    if (pending === null) return;
    const host = hosts.find((h) => Number(h.id) === pending);
    if (!host) return;
    setPending(null);
    tabs.connectHost(host);
  }, [hosts, pending, tabs]);

  // The guest's own Termix host, opened like any host: its terminal, or the
  // remote desktop it was imported with. Not imported yet: offer it.
  const openConsole = async () => {
    try {
      const { data } = await app().api.get<{ links: Record<string, number> }>(
        `/hosts/${hostId}/import/links`,
      );
      const linked = data.links[`${guest.type}:${guest.vmid}`];
      const host = hosts.find((h) => Number(h.id) === linked);
      if (host) tabs.connectHost(host);
      else setOfferImport(true);
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };

  // Proxmox's own console, through the node: for a guest with no network yet.
  // A tab of its own each time, as Proxmox opens a console window.
  const openProxmoxConsole = () => {
    if (!termixHost) return;
    const data: ConsoleTabData = {
      node: guest.node,
      type: guest.type,
      vmid: guest.vmid,
    };
    tabs.openTab(termixHost, CONSOLE_TAB, {
      label: t("console.tabLabel", { name: guestLabel(guest) }),
      forceNewTab: true,
      data: { ...data },
    });
  };

  const loadStatus = useCallback(() => {
    pve<GuestStatus>(hostId, "GET", [
      "nodes",
      guest.node,
      guest.type,
      guest.vmid,
      "status",
      "current",
    ]).then(setStatus, () => setStatus(null));
  }, [hostId, guest.node, guest.type, guest.vmid]);

  // Status follows the tree's refresh, which reloads the resource.
  useEffect(() => {
    if (isVisible) loadStatus();
  }, [loadStatus, isVisible, guest.status, guest.uptime]);

  const runAction = async (action: PowerAction) => {
    const label = t("guests.power.label", {
      action: t(`guests.power.${action}`),
      name: guestLabel(guest),
    });
    if (DESTRUCTIVE.has(action)) {
      const ok = await app().confirm({
        title: t(`guests.power.confirm.${action}`, { name: guestLabel(guest) }),
        description: t("guests.power.confirm.description"),
        confirmLabel: t(`guests.power.${action}`),
      });
      if (!ok) return;
    }
    setBusy(action);
    try {
      const upid = await pve(hostId, "POST", [...base, "status", action]);
      await track(upid, label);
      loadStatus();
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const convertToTemplate = async () => {
    const ok = await app().confirm({
      title: t("guests.template.confirm", { name: guestLabel(guest) }),
      description: t("guests.template.description"),
      confirmLabel: t("guests.template.submit"),
    });
    if (!ok) return;
    try {
      const upid = await pve(hostId, "POST", [...base, "template"]);
      void track(upid, t("guests.template.label", { name: guestLabel(guest) }));
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };

  const actions = availableActions({
    type: guest.type,
    status: status?.status ?? guest.status,
    qmpstatus: status?.qmpstatus,
    template: !!guest.template,
    lock: status?.lock ?? guest.lock,
  });
  const running = (status?.status ?? guest.status) === "running";
  const stateKey =
    status?.qmpstatus === "paused"
      ? "paused"
      : (status?.status ?? guest.status);
  const cpu = guest.cpu !== undefined && running ? guest.cpu * 100 : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{guestLabel(guest)}</h2>
        <Badge variant="outline">{t(`types.${guest.type}`)}</Badge>
        {stateKey && (
          <Badge variant="secondary">
            {t(`states.${stateKey}`, { defaultValue: stateKey })}
          </Badge>
        )}
        {guest.template ? (
          <Badge variant="outline">{t("guests.isTemplate")}</Badge>
        ) : null}
        {(status?.lock ?? guest.lock) && (
          <Badge variant="destructive">
            {t("guests.locked", { lock: status?.lock ?? guest.lock })}
          </Badge>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {!guest.template && (
            <Button
              size="sm"
              variant="outline"
              disabled={!running}
              title={t(running ? "console.openHint" : "console.notRunning")}
              onClick={() => void openConsole()}
            >
              <SquareTerminal className="mr-1 size-3.5" />
              {t("console.open")}
            </Button>
          )}
          {actions.map((action) => {
            const Icon = ICONS[action];
            return (
              <Button
                key={action}
                size="sm"
                variant={
                  action === "start" || action === "resume"
                    ? "default"
                    : "outline"
                }
                disabled={!!busy}
                onClick={() => void runAction(action)}
              >
                <Icon className="mr-1 size-3.5" />
                {t(`guests.power.${action}`)}
              </Button>
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" aria-label={t("guests.more")}>
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-44 whitespace-nowrap"
            >
              {!guest.template && termixHost && (
                <DropdownMenuItem
                  disabled={!running}
                  title={t("console.proxmoxHint")}
                  onClick={openProxmoxConsole}
                >
                  <MonitorPlay className="mr-2 size-3.5" />
                  {t("console.proxmox")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setDialog("clone")}>
                <Copy className="mr-2 size-3.5" />
                {t("guests.clone.menu")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDialog("migrate")}>
                <MoveRight className="mr-2 size-3.5" />
                {t("guests.migrate.menu")}
              </DropdownMenuItem>
              {!guest.template && (
                <DropdownMenuItem
                  disabled={running}
                  onClick={() => void convertToTemplate()}
                >
                  <LayoutTemplate className="mr-2 size-3.5" />
                  {t("guests.template.menu")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDialog("delete")}
              >
                <Trash2 className="mr-2 size-3.5" />
                {t("guests.delete.menu")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Segmented
        className="max-w-full overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap"
        value={tab}
        onChange={(value) => setTab(value as GuestTab)}
        options={tabsFor(guest).map((value) => ({
          value,
          label: t(`guests.tabs.${value}`),
        }))}
      />

      {tab === "summary" && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
            <Usage
              label={t("usage.cpu")}
              value={cpu}
              detail={
                guest.maxcpu ? t("usage.cores", { count: guest.maxcpu }) : "-"
              }
            />
            <Usage
              label={t("usage.memory")}
              value={running ? percent(guest.mem, guest.maxmem) : null}
              detail={`${running ? formatBytes(guest.mem) : "-"} / ${formatBytes(guest.maxmem)}`}
            />
            <Usage
              label={t("usage.disk")}
              value={percent(guest.disk, guest.maxdisk)}
              detail={`${formatBytes(guest.disk)} / ${formatBytes(guest.maxdisk)}`}
            />
            {!!status?.maxswap && (
              <Usage
                label={t("usage.swap")}
                value={running ? percent(status.swap, status.maxswap) : null}
                detail={`${running ? formatBytes(status.swap) : "-"} / ${formatBytes(status.maxswap)}`}
              />
            )}
          </div>

          <div>
            <GroupHeading title={t("summary.title")} />
            <Fact label={t("summary.node")}>{guest.node}</Fact>
            <Fact label={t("summary.vmid")}>{guest.vmid}</Fact>
            {ips && ips.length > 0 && (
              <Fact label={t("summary.ips")}>{ips.join(", ")}</Fact>
            )}
            <Fact label={t("summary.uptime")}>
              {formatUptime(status?.uptime ?? guest.uptime, language)}
            </Fact>
            {guest.pool && <Fact label={t("summary.pool")}>{guest.pool}</Fact>}
            {(status?.ha?.managed || guest.hastate) && (
              <Fact label={t("summary.ha")}>
                {status?.ha?.state ?? guest.hastate}
              </Fact>
            )}
            {guest.tags && (
              <Fact label={t("summary.tags")}>
                <span className="flex flex-wrap justify-end gap-1">
                  {guest.tags
                    .split(/[;, ]/)
                    .filter(Boolean)
                    .map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                </span>
              </Fact>
            )}
          </div>

          {!guest.template && (
            <RrdCharts
              hostId={hostId}
              node={guest.node}
              guest={{ type: guest.type, vmid: guest.vmid }}
              isVisible={isVisible}
            />
          )}
        </>
      )}
      {tab === "hardware" && <HardwareTab guest={ref} isVisible={isVisible} />}
      {tab === "options" && <OptionsTab guest={ref} isVisible={isVisible} />}
      {tab === "cloudinit" && (
        <CloudInitTab guest={ref} isVisible={isVisible} />
      )}
      {tab === "backup" && (
        <BackupTab guest={ref} running={running} isVisible={isVisible} />
      )}
      {tab === "firewall" && (
        <FirewallPanel
          hostId={hostId}
          base={["nodes", guest.node, guest.type, guest.vmid, "firewall"]}
          scope="guest"
          isVisible={isVisible}
        />
      )}
      {tab === "snapshots" && (
        <SnapshotsTab guest={ref} running={running} isVisible={isVisible} />
      )}

      {offerImport && (
        <ImportDialog
          hostId={hostId}
          only={{
            type: guest.type,
            vmid: guest.vmid,
            name: guestLabel(guest),
          }}
          onImported={(created) => {
            const id = created[`${guest.type}:${guest.vmid}`];
            if (id) setPending(id);
          }}
          onClose={() => setOfferImport(false)}
        />
      )}
      {dialog === "clone" && (
        <CloneDialog
          hostId={hostId}
          guest={guest}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "migrate" && (
        <MigrateDialog
          hostId={hostId}
          guest={guest}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && (
        <DeleteDialog
          hostId={hostId}
          guest={guest}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
