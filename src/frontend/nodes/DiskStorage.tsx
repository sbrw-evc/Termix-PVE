import type { ReactNode } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { useState } from "react";
import { Badge, Button } from "@termix-ssh/plugin-sdk/ui";
import { Plus } from "lucide-react";
import {
  CreateDiskStorageDialog,
  RemoveDiskStorageDialog,
  type RemoveTarget,
} from "./DiskStorageDialogs";
import { formatBytes, percent } from "../format";
import { State, useNodeData, type NodeTabProps } from "./NodeTabs";
import { volumeGroups } from "./system";

export type DiskStorageKind = "lvm" | "lvmthin" | "directory" | "zfs";

interface ThinPool {
  lv: string;
  vg: string;
  lv_size?: number;
  used?: number;
  metadata_size?: number;
  metadata_used?: number;
}

interface DirectoryMount {
  path: string;
  device?: string;
  type?: string;
  options?: string;
  unitfile?: string;
}

interface ZfsPool {
  name: string;
  size?: number;
  alloc?: number;
  free?: number;
  frag?: number;
  dedup?: number;
  health?: string;
}

const pct = (used?: number, total?: number) => {
  const value = percent(used, total);
  return value === null ? "-" : `${Math.round(value)}%`;
};

function Row({
  title,
  detail,
  badge,
  onRemove,
  removeBlocked,
}: {
  title: string;
  detail: string;
  badge?: { text: string; bad?: boolean };
  onRemove?: () => void;
  /** Why it can't be removed yet, shown on the disabled button. */
  removeBlocked?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-[11px] text-muted-foreground">
          {detail}
        </div>
      </div>
      {badge && (
        <Badge variant={badge.bad ? "destructive" : "secondary"}>
          {badge.text}
        </Badge>
      )}
      {onRemove && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-destructive"
          disabled={!!removeBlocked}
          title={removeBlocked}
          onClick={onRemove}
        >
          {t("nodes.disks.storage.remove")}
        </Button>
      )}
    </div>
  );
}

/** What a node's disks are set up as: volume groups, thin pools, directories, ZFS pools. */
export function DiskStorage({
  kind,
  hostId,
  node,
  isVisible,
}: NodeTabProps & { kind: DiskStorageKind }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<RemoveTarget | null>(null);
  const { data, error, load } = useNodeData<unknown>(
    hostId,
    ["nodes", node, "disks", kind],
    undefined,
    isVisible,
  );
  const used = (size?: number, free?: number) =>
    size ? `${formatBytes(size - (free ?? 0))} / ${formatBytes(size)}` : "-";

  let rows: ReactNode[] = [];
  if (kind === "lvm") {
    rows = volumeGroups(data).map((vg) => (
      <Row
        key={vg.name}
        title={vg.name}
        detail={[
          used(vg.size, vg.free),
          t("nodes.disks.storage.lvCount", { count: vg.lvcount ?? 0 }),
          (vg.children ?? []).map((pv) => pv.name).join(", "),
        ]
          .filter(Boolean)
          .join(" · ")}
        badge={{ text: pct((vg.size ?? 0) - (vg.free ?? 0), vg.size) }}
        onRemove={() => setRemoving({ name: vg.name })}
        removeBlocked={
          vg.lvcount ? t("nodes.disks.storage.inUse.lvm") : undefined
        }
      />
    ));
  } else if (kind === "lvmthin") {
    rows = ((data as ThinPool[] | null) ?? []).map((pool) => (
      <Row
        key={`${pool.vg}/${pool.lv}`}
        title={`${pool.vg}/${pool.lv}`}
        detail={[
          pool.lv_size
            ? `${formatBytes(pool.used)} / ${formatBytes(pool.lv_size)}`
            : "-",
          pool.metadata_size
            ? t("nodes.disks.storage.metadata", {
                used: formatBytes(pool.metadata_used),
                size: formatBytes(pool.metadata_size),
              })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        badge={{ text: pct(pool.used, pool.lv_size) }}
        onRemove={() => setRemoving({ name: pool.lv, volumeGroup: pool.vg })}
        removeBlocked={
          pool.used ? t("nodes.disks.storage.inUse.lvmthin") : undefined
        }
      />
    ));
  } else if (kind === "directory") {
    rows = ((data as DirectoryMount[] | null) ?? []).map((dir) => (
      <Row
        key={dir.path}
        title={dir.path}
        detail={[dir.device, dir.type, dir.options].filter(Boolean).join(" · ")}
        onRemove={() =>
          setRemoving({ name: dir.path.split("/").filter(Boolean).pop() ?? "" })
        }
      />
    ));
  } else {
    rows = ((data as ZfsPool[] | null) ?? []).map((pool) => (
      <Row
        key={pool.name}
        title={pool.name}
        detail={[
          pool.size
            ? `${formatBytes(pool.alloc)} / ${formatBytes(pool.size)}`
            : null,
          pool.frag !== undefined
            ? t("nodes.disks.storage.frag", { value: pool.frag })
            : null,
          pool.dedup !== undefined && pool.dedup !== 1
            ? t("nodes.disks.storage.dedup", { value: pool.dedup })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        badge={
          pool.health
            ? { text: pool.health, bad: pool.health !== "ONLINE" }
            : undefined
        }
        onRemove={() => setRemoving({ name: pool.name })}
      />
    ));
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center pb-1">
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          <Plus className="mr-1 size-3.5" />
          {t(`nodes.disks.storage.create.${kind}`)}
        </Button>
      </div>
      <State error={error} loading={data === null && !error} />
      {data !== null && rows.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t(`nodes.disks.storage.none.${kind}`)}
        </p>
      )}
      {rows}
      {creating && (
        <CreateDiskStorageDialog
          kind={kind}
          hostId={hostId}
          node={node}
          onClose={() => setCreating(false)}
          onDone={load}
        />
      )}
      {removing && (
        <RemoveDiskStorageDialog
          kind={kind}
          hostId={hostId}
          node={node}
          target={removing}
          onClose={() => setRemoving(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
