import { useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  GroupHeading,
  Textarea,
} from "@termix-ssh/plugin-sdk/ui";
import { Copy } from "lucide-react";
import { pve, toCallError } from "../api";
import { Fact } from "../components/Usage";
import { guestCounts } from "../tree";
import { useApiList } from "./crud";
import {
  clusterOf,
  joinInformation,
  type ClusterJoin,
  type ClusterStatusEntry,
} from "./cluster";
import type { DatacenterProps } from "./DatacenterView";

/** The cluster at a glance: quorum, nodes and what a new node needs to join. */
export function SummaryPanel({
  hostId,
  resources,
  isVisible,
}: DatacenterProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, error } = useApiList<ClusterStatusEntry[]>(
    hostId,
    ["cluster", "status"],
    undefined,
    isVisible,
  );
  const [join, setJoin] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const cluster = data ? clusterOf(data) : null;
  const nodes = (data ?? []).filter((e) => e.type === "node");
  const counts = guestCounts(resources);

  const loadJoin = async () => {
    try {
      const info = joinInformation(
        await pve<ClusterJoin>(hostId, "GET", ["cluster", "config", "join"]),
      );
      setJoin(info);
      setJoinError(info ? null : t("datacenter.summary.noJoin"));
    } catch (err) {
      setJoinError(toCallError(err).message);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-1">
        <GroupHeading title={t("datacenter.summary.title")} />
        {error && <p className="text-xs text-destructive">{error}</p>}
        {data && (
          <>
            <Fact label={t("datacenter.summary.cluster")}>
              {cluster ? cluster.name : t("datacenter.summary.standalone")}
            </Fact>
            {cluster && (
              <Fact label={t("datacenter.summary.quorum")}>
                {t(
                  cluster.quorate
                    ? "datacenter.summary.quorate"
                    : "datacenter.summary.noQuorum",
                )}
              </Fact>
            )}
            <Fact label={t("datacenter.summary.nodes")}>
              {t("datacenter.summary.nodesOnline", {
                online: nodes.filter((n) => n.online).length,
                total: nodes.length,
              })}
            </Fact>
            <Fact label={t("datacenter.summary.guests")}>
              {t("datacenter.summary.guestsRunning", {
                running: counts.running,
                total: counts.total,
              })}
            </Fact>
          </>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <GroupHeading
          title={t("datacenter.summary.nodeList")}
          count={nodes.length}
        />
        {nodes.map((node) => (
          <div
            key={node.name}
            className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
          >
            <span
              className={
                node.online
                  ? "size-1.5 rounded-full bg-emerald-500"
                  : "size-1.5 rounded-full bg-muted-foreground/50"
              }
            />
            <span className="font-medium">{node.name}</span>
            <span className="text-muted-foreground">{node.ip}</span>
            {node.local ? (
              <Badge variant="outline">
                {t("datacenter.summary.thisNode")}
              </Badge>
            ) : null}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-1">
        <GroupHeading
          title={t("datacenter.summary.join")}
          action={
            cluster ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => void loadJoin()}
              >
                {t("datacenter.summary.showJoin")}
              </Button>
            ) : null
          }
        />
        <p className="text-[11px] text-muted-foreground">
          {t(
            cluster
              ? "datacenter.summary.joinHint"
              : "datacenter.summary.createHint",
          )}
        </p>
        {joinError && <p className="text-xs text-destructive">{joinError}</p>}
        {join && (
          <div className="flex flex-col gap-1">
            <Textarea
              readOnly
              value={join}
              rows={4}
              className="font-mono text-[11px]"
            />
            <div>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => {
                  void navigator.clipboard.writeText(join).then(
                    () => toast.success(t("datacenter.summary.copied")),
                    () => toast.error(t("datacenter.summary.copyFailed")),
                  );
                }}
              >
                <Copy className="mr-1 size-3" />
                {t("datacenter.summary.copy")}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
