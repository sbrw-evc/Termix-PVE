import { useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  GroupHeading,
} from "@termix-ssh/plugin-sdk/ui";
import { KeyRound, RefreshCw, Trash2 } from "lucide-react";
import { app, pve, toCallError } from "../api";
import { Fact } from "../components/Usage";
import { Field, FormDialog, TextInput } from "../components/forms";
import { State, useNodeData, type NodeTabProps } from "./NodeTabs";

interface Subscription {
  status: string;
  message?: string;
  serverid?: string;
  key?: string;
  level?: string;
  productname?: string;
  regdate?: string;
  nextduedate?: string;
  checktime?: number;
  sockets?: number;
  url?: string;
}

/** A Proxmox subscription key: pve1c-0123456789 and the like. */
export const SUBSCRIPTION_KEY =
  /^\s*pve([1248])([cbsp])-(arm-)?[0-9a-f]{10}\s*$/;

export function SubscriptionTab({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, error, load } = useNodeData<Subscription>(
    hostId,
    ["nodes", node, "subscription"],
    undefined,
    isVisible,
  );
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = data?.status === "active";

  const check = async () => {
    setBusy(true);
    try {
      await pve(hostId, "POST", ["nodes", node, "subscription"], {
        force: true,
      });
      toast.success(t("subscription.checked"));
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      setBusy(false);
      void load();
    }
  };

  const remove = async () => {
    const ok = await app().confirm({
      title: t("subscription.removeTitle"),
      description: t("subscription.removeDescription"),
      confirmLabel: t("subscription.remove"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await pve(hostId, "DELETE", ["nodes", node, "subscription"]);
      toast.success(t("subscription.removed"));
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      void load();
    }
  };

  return (
    <section className="flex flex-col gap-1">
      <GroupHeading
        title={t("subscription.title")}
        action={
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => setUploading(true)}
            >
              <KeyRound className="mr-1 size-3" />
              {t("subscription.upload")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={busy || !data?.key}
              onClick={() => void check()}
            >
              <RefreshCw className="mr-1 size-3" />
              {t("subscription.check")}
            </Button>
            {data?.key && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-destructive"
                onClick={() => void remove()}
              >
                <Trash2 className="mr-1 size-3" />
                {t("subscription.remove")}
              </Button>
            )}
          </div>
        }
      />
      <State error={error} loading={!data && !error} />
      {data && (
        <>
          <Fact label={t("subscription.status")}>
            <Badge variant={active ? "secondary" : "outline"}>
              {data.status}
            </Badge>
          </Fact>
          {data.message && (
            <Fact label={t("subscription.message")}>{data.message}</Fact>
          )}
          {data.productname && (
            <Fact label={t("subscription.product")}>{data.productname}</Fact>
          )}
          {data.key && <Fact label={t("subscription.key")}>{data.key}</Fact>}
          {data.sockets ? (
            <Fact label={t("subscription.sockets")}>{data.sockets}</Fact>
          ) : null}
          {data.nextduedate && (
            <Fact label={t("subscription.nextDue")}>{data.nextduedate}</Fact>
          )}
          {data.checktime ? (
            <Fact label={t("subscription.lastChecked")}>
              {new Date(data.checktime * 1000).toLocaleString()}
            </Fact>
          ) : null}
          <Fact label={t("subscription.serverId")}>
            <span className="font-mono">{data.serverid}</span>
          </Fact>
        </>
      )}
      {uploading && (
        <KeyDialog
          hostId={hostId}
          node={node}
          onClose={() => setUploading(false)}
          onDone={load}
        />
      )}
    </section>
  );
}

function KeyDialog({
  hostId,
  node,
  onClose,
  onDone,
}: {
  hostId: number;
  node: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [key, setKey] = useState("");
  return (
    <FormDialog
      title={t("subscription.uploadTitle", { node })}
      submitLabel={t("subscription.upload")}
      canSubmit={SUBSCRIPTION_KEY.test(key)}
      onClose={onClose}
      onSubmit={async () => {
        await pve(hostId, "PUT", ["nodes", node, "subscription"], {
          key: key.trim(),
        });
        toast.success(t("subscription.uploaded"));
        onDone();
      }}
    >
      {() => (
        <Field label={t("subscription.key")} hint={t("subscription.keyHint")}>
          <TextInput
            value={key}
            onChange={setKey}
            placeholder="pve1c-0123456789"
          />
        </Field>
      )}
    </FormDialog>
  );
}

interface ReplicationState {
  id: string;
  guest: number;
  target: string;
  schedule?: string;
  last_sync?: number;
  next_sync?: number;
  duration?: number;
  fail_count?: number;
  error?: string;
  pid?: number;
}

/** The replication jobs running from this node, with their state and log. */
export function NodeReplicationTab({ hostId, node, isVisible }: NodeTabProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, error, load } = useNodeData<ReplicationState[]>(
    hostId,
    ["nodes", node, "replication"],
    undefined,
    isVisible,
  );
  const [log, setLog] = useState<ReplicationState | null>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  const when = (s?: number) => (s ? new Date(s * 1000).toLocaleString() : "-");

  const showLog = async (job: ReplicationState) => {
    setLog(job);
    setLines(null);
    try {
      const rows = await pve<Array<{ t: string }>>(hostId, "GET", [
        "nodes",
        node,
        "replication",
        job.id,
        "log",
      ]);
      setLines((rows ?? []).map((r) => r.t));
    } catch (err) {
      setLines([toCallError(err).message]);
    }
  };

  return (
    <div className="flex flex-col">
      <State error={error} loading={!data && !error} />
      {data?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t("replication.noneFromNode")}
        </p>
      )}
      {data?.map((job) => (
        <div
          key={job.id}
          className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
        >
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {job.id} → {job.target}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {[
                t("replication.lastSync", { when: when(job.last_sync) }),
                t("replication.nextSync", { when: when(job.next_sync) }),
                job.duration ? `${job.duration.toFixed(1)} s` : null,
                job.error,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          {job.pid ? (
            <Badge variant="outline">{t("replication.running")}</Badge>
          ) : null}
          {job.fail_count ? (
            <Badge variant="destructive">
              {t("replication.failing", { count: job.fail_count })}
            </Badge>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={() => void showLog(job)}
          >
            {t("replication.log")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={async () => {
              try {
                await pve(hostId, "POST", [
                  "nodes",
                  node,
                  "replication",
                  job.id,
                  "schedule_now",
                ]);
                toast.success(t("replication.scheduled", { id: job.id }));
              } catch (err) {
                toast.error(toCallError(err).message);
              } finally {
                void load();
              }
            }}
          >
            {t("replication.runNow")}
          </Button>
        </div>
      ))}
      {log && (
        <Dialog open onOpenChange={(open) => !open && setLog(null)}>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                {t("replication.logTitle", { id: log.id })}
              </DialogTitle>
            </DialogHeader>
            <pre className="h-96 overflow-auto border border-border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {lines ? lines.join("\n") : t("app.loading")}
            </pre>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
