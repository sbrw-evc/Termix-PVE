import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, DropdownMenuItem } from "@termix-ssh/plugin-sdk/ui";
import { app, pve, toCallError } from "../api";
import { useTasks } from "../tasks";
import { CrudSection, useApiList, type FieldSpec } from "./crud";
import {
  KEEP,
  jobParams,
  jobToForm,
  vzdumpFromJob,
  type BackupJob,
} from "./backup";
import { nodeNames, type DatacenterProps } from "./DatacenterView";

const MODES = ["snapshot", "suspend", "stop"];
const COMPRESS = ["zstd", "lzo", "gzip", "0"];

export function backupStorages(data: unknown): string[] {
  return (
    (data as Array<{ storage: string; content?: string; disable?: number }>) ??
    []
  )
    .filter(
      (s) => !s.disable && (s.content ?? "").split(",").includes("backup"),
    )
    .map((s) => s.storage)
    .sort();
}

export function BackupPanel({ hostId, resources, isVisible }: DatacenterProps) {
  const { t, language } = useTranslation();
  const toast = useToast();
  const { track } = useTasks();
  const storages = useApiList<unknown>(
    hostId,
    ["storage"],
    undefined,
    isVisible,
  );
  const pools = useApiList<Array<{ poolid: string }>>(
    hostId,
    ["pools"],
    undefined,
    isVisible,
  );
  const nodes = nodeNames(resources);

  const fields: FieldSpec[] = [
    {
      key: "schedule",
      labelKey: "backup.job.schedule",
      hintKey: "backup.job.scheduleHint",
      required: true,
      default: "21:00",
    },
    {
      key: "storage",
      labelKey: "backup.job.storage",
      kind: "select",
      required: true,
      options: backupStorages(storages.data).map((value) => ({ value })),
    },
    {
      key: "selection",
      labelKey: "backup.job.selection",
      kind: "select",
      required: true,
      default: "all",
      local: true,
      options: (["all", "exclude", "vmid", "pool"] as const).map((value) => ({
        value,
        labelKey: `backup.job.selections.${value}`,
      })),
    },
    {
      key: "vmid",
      labelKey: "backup.job.vmid",
      placeholder: "100,101",
      required: true,
      pattern: /^\d+(,\d+)*$/,
      patternKey: "backup.job.vmidFormat",
      showIf: (v) => v.selection === "vmid",
      local: true,
    },
    {
      key: "exclude",
      labelKey: "backup.job.exclude",
      placeholder: "100,101",
      required: true,
      pattern: /^\d+(,\d+)*$/,
      patternKey: "backup.job.vmidFormat",
      showIf: (v) => v.selection === "exclude",
      local: true,
    },
    {
      key: "pool",
      labelKey: "backup.job.pool",
      kind: "select",
      required: true,
      showIf: (v) => v.selection === "pool",
      local: true,
      options: (pools.data ?? []).map((p) => ({ value: p.poolid })),
    },
    {
      key: "node",
      labelKey: "backup.job.node",
      hintKey: "backup.job.nodeHint",
      kind: "select",
      options: nodes.map((value) => ({ value })),
    },
    {
      key: "mode",
      labelKey: "backup.job.mode",
      kind: "select",
      required: true,
      default: "snapshot",
      options: MODES.map((value) => ({
        value,
        labelKey: `backup.modes.${value}`,
      })),
    },
    {
      key: "compress",
      labelKey: "backup.job.compress",
      kind: "select",
      required: true,
      default: "zstd",
      options: COMPRESS.map((value) => ({
        value,
        labelKey: value === "0" ? "backup.noCompression" : undefined,
        label: value,
      })),
    },
    {
      key: "notes-template",
      labelKey: "backup.job.notes",
      hintKey: "backup.job.notesHint",
      placeholder: "{{guestname}}",
    },
    ...KEEP.map((key): FieldSpec => ({
      key,
      labelKey: `backup.keep.${key}`,
      kind: "number",
      local: true,
    })),
    { key: "comment", labelKey: "backup.job.comment" },
    {
      key: "enabled",
      labelKey: "backup.job.enabled",
      kind: "check",
      default: true,
    },
  ];

  const runNow = async (job: BackupJob) => {
    const targets = job.node ? [job.node] : nodes;
    const ok = await app().confirm({
      title: t("backup.runTitle", { id: job.id }),
      description: t("backup.runDescription", { nodes: targets.join(", ") }),
      confirmLabel: t("backup.run"),
    });
    if (!ok) return;
    for (const node of targets) {
      try {
        const upid = await pve(
          hostId,
          "POST",
          ["nodes", node, "vzdump"],
          vzdumpFromJob(job),
        );
        void track(upid, t("backup.runLabel", { id: job.id, node }));
      } catch (err) {
        toast.error(`${node}: ${toCallError(err).message}`);
      }
    }
  };

  const when = (seconds?: number) =>
    seconds
      ? new Date(seconds * 1000).toLocaleString(language, {
          dateStyle: "short",
          timeStyle: "short",
        })
      : null;

  return (
    <div className="flex flex-col gap-5">
      <CrudSection<BackupJob>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="backup.jobs"
        hintKey="backup.jobsHint"
        emptyKey="backup.noJobs"
        listPath={["cluster", "backup"]}
        rowId={(job) => job.id}
        view={(job) => ({
          title: job.comment || job.id,
          badges: (
            <>
              <Badge variant="outline">{job.schedule}</Badge>
              {!job.enabled ? (
                <Badge variant="secondary">{t("backup.disabled")}</Badge>
              ) : null}
            </>
          ),
          detail: [
            job.all
              ? job.exclude
                ? t("backup.whatExclude", { ids: job.exclude })
                : t("backup.whatAll")
              : job.pool
                ? t("backup.whatPool", { pool: job.pool })
                : t("backup.whatVmid", { ids: job.vmid }),
            `→ ${job.storage}`,
            t(`backup.modes.${job.mode ?? "snapshot"}`),
            job["next-run"]
              ? t("backup.next", { when: when(job["next-run"]) })
              : null,
          ]
            .filter(Boolean)
            .join(" · "),
        })}
        fields={fields}
        prepare={jobToForm}
        toParams={jobParams}
        createLabelKey="backup.addJob"
        dialogTitle={(creating, job) =>
          creating
            ? t("backup.addJobTitle")
            : t("backup.editJobTitle", { id: job?.comment || job?.id })
        }
        itemPath={(job) => ["cluster", "backup", job.id]}
        loadItem
        menu={(job) => (
          <DropdownMenuItem onClick={() => void runNow(job)}>
            {t("backup.run")}
          </DropdownMenuItem>
        )}
        deleteText={(job) => ({
          title: t("backup.deleteJobTitle", { id: job.comment || job.id }),
          description: t("backup.deleteJobDescription"),
        })}
      />
      <CrudSection<{ vmid: number; name?: string; type: string }>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="backup.notBackedUp"
        hintKey="backup.notBackedUpHint"
        emptyKey="backup.allBackedUp"
        listPath={["cluster", "backup-info", "not-backed-up"]}
        rowId={(g) => String(g.vmid)}
        view={(g) => ({
          title: `${g.vmid} ${g.name ?? ""}`,
          badges: (
            <Badge variant="outline">
              {t(`types.${g.type}`, { defaultValue: g.type })}
            </Badge>
          ),
        })}
        readOnly
      />
    </div>
  );
}
