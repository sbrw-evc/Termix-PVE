import { useEffect, useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, DropdownMenuItem } from "@termix-ssh/plugin-sdk/ui";
import { pve, toCallError, type PveParams } from "../api";
import {
  CrudSection,
  paramsFrom,
  type FieldSpec,
  type FormValues,
} from "./crud";
import {
  guestOptions,
  nodeNames,
  type DatacenterProps,
} from "./DatacenterView";

interface ReplicationJob extends Record<string, unknown> {
  id: string;
  guest: number;
  target: string;
  source?: string;
  schedule?: string;
  rate?: number;
  comment?: string;
  disable?: number;
}

interface ReplicationStatus {
  id: string;
  last_sync?: number;
  fail_count?: number;
  error?: string;
  duration?: number;
}

/** The next free job id for a guest: Proxmox numbers them 100-0, 100-1, … */
export function nextReplicationId(
  vmid: string,
  jobs: Array<{ id: string }>,
): string {
  const used = new Set(
    jobs.filter((j) => j.id.startsWith(`${vmid}-`)).map((j) => j.id),
  );
  let n = 0;
  while (used.has(`${vmid}-${n}`)) n++;
  return `${vmid}-${n}`;
}

export function ReplicationPanel({
  hostId,
  resources,
  isVisible,
}: DatacenterProps) {
  const { t, language } = useTranslation();
  const toast = useToast();
  const nodes = nodeNames(resources);
  const guests = guestOptions(resources);
  const [jobs, setJobs] = useState<ReplicationJob[]>([]);
  const [status, setStatus] = useState<Record<string, ReplicationStatus>>({});

  // Last sync and errors live on each source node.
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    void Promise.all(
      nodes.map((node) =>
        pve<ReplicationStatus[]>(hostId, "GET", [
          "nodes",
          node,
          "replication",
        ]).catch(() => []),
      ),
    ).then((lists) => {
      if (cancelled) return;
      setStatus(Object.fromEntries(lists.flat().map((s) => [s.id, s])));
    });
    return () => {
      cancelled = true;
    };
    // nodes is derived from resources each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, isVisible, nodes.join()]);

  const fields: FieldSpec[] = [
    {
      key: "guest",
      labelKey: "replication.guest",
      kind: "select",
      required: true,
      createOnly: true,
      local: true,
      options: guests.map((g) => ({ value: g.value, label: g.label })),
    },
    {
      key: "target",
      labelKey: "replication.target",
      kind: "select",
      required: true,
      createOnly: true,
      options: nodes.map((value) => ({ value })),
    },
    {
      key: "schedule",
      labelKey: "replication.schedule",
      hintKey: "replication.scheduleHint",
      default: "*/15",
    },
    {
      key: "rate",
      labelKey: "replication.rate",
      hintKey: "replication.rateHint",
      kind: "number",
    },
    { key: "comment", labelKey: "replication.comment" },
    { key: "disable", labelKey: "replication.disable", kind: "check" },
  ];

  const when = (seconds?: number) =>
    seconds
      ? new Date(seconds * 1000).toLocaleString(language, {
          dateStyle: "short",
          timeStyle: "short",
        })
      : null;

  return (
    <CrudSection<ReplicationJob>
      hostId={hostId}
      isVisible={isVisible}
      titleKey="replication.title"
      hintKey={nodes.length < 2 ? "replication.singleNode" : "replication.hint"}
      emptyKey="replication.none"
      listPath={["cluster", "replication"]}
      // Kept for picking the next id when creating.
      onLoaded={setJobs}
      rowId={(job) => job.id}
      view={(job) => {
        const s = status[job.id];
        return {
          title: `${job.id} → ${job.target}`,
          badges: (
            <>
              <Badge variant="outline">{job.schedule ?? "*/15"}</Badge>
              {job.disable ? (
                <Badge variant="secondary">{t("replication.disabled")}</Badge>
              ) : null}
              {s?.fail_count ? (
                <Badge variant="destructive">
                  {t("replication.failing", { count: s.fail_count })}
                </Badge>
              ) : null}
            </>
          ),
          detail: [
            s?.last_sync
              ? t("replication.lastSync", { when: when(s.last_sync) })
              : t("replication.neverSynced"),
            s?.error,
            job.rate ? t("replication.rateValue", { rate: job.rate }) : null,
            job.comment,
          ]
            .filter(Boolean)
            .join(" · "),
        };
      }}
      fields={fields}
      toParams={(values: FormValues, creating): PveParams => {
        const params = paramsFrom(fields, values, creating);
        if (creating) {
          params.id = nextReplicationId(String(values.guest), jobs);
          params.type = "local";
        }
        return params;
      }}
      createLabelKey="replication.add"
      itemPath={(job) => ["cluster", "replication", job.id]}
      menu={(job, reload) => (
        <DropdownMenuItem
          onClick={async () => {
            const source =
              job.source ?? resources.find((r) => r.vmid === job.guest)?.node;
            if (!source) return;
            try {
              await pve(hostId, "POST", [
                "nodes",
                source,
                "replication",
                job.id,
                "schedule_now",
              ]);
              toast.success(t("replication.scheduled", { id: job.id }));
              reload();
            } catch (err) {
              toast.error(toCallError(err).message);
            }
          }}
        >
          {t("replication.runNow")}
        </DropdownMenuItem>
      )}
      deleteText={(job) => ({
        title: t("replication.deleteTitle", { id: job.id }),
        description: t("replication.deleteDescription", { target: job.target }),
      })}
    />
  );
}
