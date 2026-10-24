import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, GroupHeading } from "@termix-ssh/plugin-sdk/ui";
import type { PveResource } from "../api";
import { guestLabel, isGuest } from "../tree";
import { Fact } from "./Usage";

/** A pool: the guests and storage in it. Managing pools comes with access. */
export function PoolView({
  pool,
  resources,
}: {
  pool: PveResource;
  resources: PveResource[];
}) {
  const { t } = useTranslation();
  const members = resources.filter(
    (r) => r.pool === pool.pool && r.type !== "pool",
  );
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{pool.pool}</h2>
        <Badge variant="outline">{t("types.pool")}</Badge>
      </div>
      <div>
        <GroupHeading title={t("pool.members")} count={members.length} />
        {members.length === 0 && (
          <p className="py-2 text-xs text-muted-foreground">
            {t("pool.empty")}
          </p>
        )}
        {members.map((m) => (
          <Fact
            key={m.id}
            label={t(`types.${m.type}`, { defaultValue: m.type })}
          >
            {isGuest(m) ? guestLabel(m) : (m.storage ?? m.id)}
            {m.node ? ` (${m.node})` : ""}
          </Fact>
        ))}
      </div>
    </div>
  );
}

/** An SDN zone as /cluster/resources reports it. */
export function SdnView({ zone }: { zone: PveResource & { sdn?: string } }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{zone.sdn ?? zone.id}</h2>
        <Badge variant="outline">{t("types.sdn")}</Badge>
        {zone.status && <Badge variant="secondary">{zone.status}</Badge>}
      </div>
      <div>
        <GroupHeading title={t("summary.title")} />
        <Fact label={t("summary.node")}>{zone.node}</Fact>
      </div>
      <p className="text-xs text-muted-foreground">{t("sdn.hint")}</p>
    </div>
  );
}
