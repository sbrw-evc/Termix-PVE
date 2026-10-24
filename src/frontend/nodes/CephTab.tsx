import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, GroupHeading } from "@termix-ssh/plugin-sdk/ui";
import { formatBytes } from "../format";
import { Fact } from "../components/Usage";
import { CrudSection, useApiList } from "../datacenter/crud";
import type { NodeTabProps } from "./NodeTabs";

interface CephStatus {
  health?: {
    status?: string;
    checks?: Record<string, { summary?: { message?: string } }>;
  };
  pgmap?: { bytes_used?: number; bytes_total?: number; num_pgs?: number };
  osdmap?: { num_osds?: number; num_up_osds?: number; num_in_osds?: number };
  monmap?: { mons?: unknown[] };
}

/** Whether an answer means Ceph is simply not set up on this node. */
export function cephMissing(error: string | null): boolean {
  return (
    !!error &&
    /not (installed|initialized)|binary not installed|no such file|ceph\.conf|rados_connect|got timeout/i.test(
      error,
    )
  );
}

const HEALTH: Record<string, "secondary" | "outline" | "destructive"> = {
  HEALTH_OK: "secondary",
  HEALTH_WARN: "outline",
  HEALTH_ERR: "destructive",
};

/** Ceph on a node, read only: health, monitors, OSDs and pools. Setting it up stays in Proxmox. */
export function CephTab({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const { data, error } = useApiList<CephStatus>(
    hostId,
    ["nodes", node, "ceph", "status"],
    undefined,
    isVisible,
  );
  if (cephMissing(error)) {
    return (
      <div className="flex flex-col gap-1">
        <GroupHeading title={t("ceph.title")} />
        <p className="text-xs text-muted-foreground">
          {t("ceph.notInstalled")}
        </p>
      </div>
    );
  }
  const health = data?.health?.status;
  const checks = Object.values(data?.health?.checks ?? {})
    .map((c) => c.summary?.message)
    .filter(Boolean);
  const ready = !!data && isVisible;
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1">
        <GroupHeading
          title={t("ceph.title")}
          action={
            health ? (
              <Badge variant={HEALTH[health] ?? "outline"}>{health}</Badge>
            ) : null
          }
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        {data && (
          <>
            <Fact label={t("ceph.usage")}>
              {formatBytes(data.pgmap?.bytes_used)} /{" "}
              {formatBytes(data.pgmap?.bytes_total)}
            </Fact>
            <Fact label={t("ceph.osds")}>
              {t("ceph.osdCount", {
                total: data.osdmap?.num_osds ?? 0,
                up: data.osdmap?.num_up_osds ?? 0,
                in: data.osdmap?.num_in_osds ?? 0,
              })}
            </Fact>
            <Fact label={t("ceph.monitors")}>
              {data.monmap?.mons?.length ?? 0}
            </Fact>
            <Fact label={t("ceph.pgs")}>{data.pgmap?.num_pgs ?? 0}</Fact>
            {checks.map((message) => (
              <p key={message} className="text-[11px] text-destructive">
                {message}
              </p>
            ))}
          </>
        )}
      </section>
      <CrudSection<{
        name: string;
        host?: string;
        addr?: string;
        quorum?: number;
      }>
        hostId={hostId}
        isVisible={ready}
        titleKey="ceph.monitors"
        emptyKey="ceph.none"
        listPath={["nodes", node, "ceph", "mon"]}
        rowId={(m) => m.name}
        view={(m) => ({
          title: m.name,
          badges: m.quorum ? (
            <Badge variant="secondary">{t("ceph.inQuorum")}</Badge>
          ) : null,
          detail: [m.host, m.addr].filter(Boolean).join(" · "),
        })}
        readOnly
      />
      <CrudSection<{
        pool_name: string;
        size?: number;
        min_size?: number;
        pg_num?: number;
        bytes_used?: number;
        percent_used?: number;
      }>
        hostId={hostId}
        isVisible={ready}
        titleKey="ceph.pools"
        emptyKey="ceph.none"
        listPath={["nodes", node, "ceph", "pool"]}
        rowId={(p) => p.pool_name}
        view={(p) => ({
          title: p.pool_name,
          detail: [
            t("ceph.replicas", { size: p.size ?? "-", min: p.min_size ?? "-" }),
            `PG ${p.pg_num ?? "-"}`,
            p.bytes_used !== undefined ? formatBytes(p.bytes_used) : null,
          ]
            .filter(Boolean)
            .join(" · "),
        })}
        readOnly
      />
    </div>
  );
}
