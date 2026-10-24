import { useEffect, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, Button, GroupHeading } from "@termix-ssh/plugin-sdk/ui";
import { Box, Monitor } from "lucide-react";
import { pve, type PveResource } from "../api";
import { formatBytes, formatUptime, percent } from "../format";
import { isGuest } from "../tree";
import { Fact, Usage } from "./Usage";
import { RrdCharts } from "./RrdCharts";
import { CreateCtDialog, CreateVmDialog } from "../guests/CreateDialogs";

interface NodeStatus {
  pveversion?: string;
  kversion?: string;
  loadavg?: string[];
  cpuinfo?: { model?: string; cpus?: number; sockets?: number };
  uptime?: number;
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
  const { t } = useTranslation();
  const name = node.node ?? node.id;
  const [status, setStatus] = useState<NodeStatus | null>(null);
  const [dialog, setDialog] = useState<"vm" | "ct" | null>(null);
  const online = node.status === "online";

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
        <div className="ml-auto flex gap-1">
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
        </div>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-2">
        <Usage
          label={t("usage.cpu")}
          value={node.cpu !== undefined ? node.cpu * 100 : null}
          detail={node.maxcpu ? t("usage.cores", { count: node.maxcpu }) : "-"}
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
      </div>

      <div>
        <GroupHeading title={t("summary.title")} />
        <Fact label={t("summary.uptime")}>
          {formatUptime(status?.uptime ?? node.uptime)}
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
    </div>
  );
}
