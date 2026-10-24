import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, GroupHeading } from "@termix-ssh/plugin-sdk/ui";
import type { PveResource } from "../api";
import { formatBytes, percent } from "../format";
import { Fact, Usage } from "./Usage";

/** Storage is read only in this release; its content comes with templates and images. */
export function StorageView({ storage }: { storage: PveResource }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{storage.storage}</h2>
        <Badge variant="outline">{t("types.storage")}</Badge>
        {storage.status && (
          <Badge variant="secondary">
            {t(`states.${storage.status}`, { defaultValue: storage.status })}
          </Badge>
        )}
      </div>
      <Usage
        label={t("usage.usage")}
        value={percent(storage.disk, storage.maxdisk)}
        detail={`${formatBytes(storage.disk)} / ${formatBytes(storage.maxdisk)}`}
      />
      <div>
        <GroupHeading title={t("summary.title")} />
        <Fact label={t("summary.node")}>{storage.node}</Fact>
      </div>
    </div>
  );
}
