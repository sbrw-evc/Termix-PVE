import { useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, Segmented } from "@termix-ssh/plugin-sdk/ui";
import type { PveResource } from "../api";
import { SummaryPanel } from "./SummaryPanel";
import { StoragePanel } from "./StoragePanel";
import { BackupPanel } from "./BackupPanel";
import { ReplicationPanel } from "./ReplicationPanel";
import { AccessPanel } from "./AccessPanel";
import { HaPanel } from "./HaPanel";
import { FirewallPanel } from "./FirewallPanel";
import { OptionsPanel } from "./OptionsPanel";
import { SdnPanel } from "./SdnPanel";
import { MetricsPanel } from "./MetricsPanel";
import { MappingsPanel } from "./MappingsPanel";
import { NotificationsPanel } from "./NotificationsPanel";

type DatacenterTab =
  | "summary"
  | "options"
  | "storage"
  | "backup"
  | "replication"
  | "permissions"
  | "ha"
  | "sdn"
  | "firewall"
  | "metrics"
  | "mappings"
  | "notifications";
/** In the order of Proxmox's Datacenter menu. */
const TABS: DatacenterTab[] = [
  "summary",
  "options",
  "storage",
  "backup",
  "replication",
  "permissions",
  "ha",
  "sdn",
  "firewall",
  "metrics",
  "mappings",
  "notifications",
];

export interface DatacenterProps {
  hostId: number;
  resources: PveResource[];
  isVisible: boolean;
  /** "Datacenter (host)" when the tree holds several hosts. */
  title?: string;
}

export function DatacenterView(props: DatacenterProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DatacenterTab>("summary");
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">
          {props.title ?? t("tree.datacenter")}
        </h2>
        <Badge variant="outline">{t("datacenter.badge")}</Badge>
      </div>
      <Segmented
        className="max-w-full overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap"
        value={tab}
        onChange={(v) => setTab(v as DatacenterTab)}
        options={TABS.map((value) => ({
          value,
          label: t(`datacenter.tabs.${value}`),
        }))}
      />
      {tab === "summary" && <SummaryPanel {...props} />}
      {tab === "options" && <OptionsPanel {...props} />}
      {tab === "storage" && <StoragePanel {...props} />}
      {tab === "backup" && <BackupPanel {...props} />}
      {tab === "replication" && <ReplicationPanel {...props} />}
      {tab === "permissions" && <AccessPanel {...props} />}
      {tab === "ha" && <HaPanel {...props} />}
      {tab === "sdn" && <SdnPanel {...props} />}
      {tab === "firewall" && (
        <FirewallPanel
          hostId={props.hostId}
          base={["cluster", "firewall"]}
          scope="cluster"
          isVisible={props.isVisible}
        />
      )}
      {tab === "metrics" && <MetricsPanel {...props} />}
      {tab === "mappings" && <MappingsPanel {...props} />}
      {tab === "notifications" && <NotificationsPanel {...props} />}
    </div>
  );
}

/** Online nodes of the cluster, by name. */
export function nodeNames(resources: PveResource[]): string[] {
  return resources
    .filter((r) => r.type === "node" && r.node)
    .map((r) => r.node!)
    .sort();
}

/** Guests as "100 (name)" choices, by id. */
export function guestOptions(resources: PveResource[]) {
  return resources
    .filter(
      (r) => (r.type === "qemu" || r.type === "lxc") && r.vmid !== undefined,
    )
    .sort((a, b) => a.vmid! - b.vmid!)
    .map((r) => ({
      value: String(r.vmid),
      label: `${r.vmid} (${r.name ?? r.type})`,
      type: r.type as "qemu" | "lxc",
      node: r.node,
    }));
}
