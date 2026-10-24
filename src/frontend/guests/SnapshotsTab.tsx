import { useCallback, useEffect, useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Textarea,
} from "@termix-ssh/plugin-sdk/ui";
import { Camera, MoreHorizontal, RotateCcw } from "lucide-react";
import { app, pve, toCallError } from "../api";
import { useTasks } from "../tasks";
import { CheckField, Field, FormDialog, TextInput } from "../components/forms";
import { guestPath, type GuestRef } from "./useGuestConfig";
import {
  CURRENT,
  snapshotNameProblem,
  snapshotTree,
  suggestSnapshotName,
  type Snapshot,
} from "./snapshots";

function TakeDialog({
  guest,
  running,
  existing,
  onClose,
  onDone,
}: {
  guest: GuestRef;
  running: boolean;
  existing: Snapshot[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [name, setName] = useState(suggestSnapshotName);
  const [description, setDescription] = useState("");
  const [vmstate, setVmstate] = useState(false);
  const problem = snapshotNameProblem(name, existing);
  return (
    <FormDialog
      title={t("snapshots.takeTitle", { vmid: guest.vmid })}
      submitLabel={t("snapshots.take")}
      canSubmit={!problem}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          guest.hostId,
          "POST",
          guestPath(guest, "snapshot"),
          {
            snapname: name,
            description: description || undefined,
            // Only VMs can keep their RAM, and only while they run.
            vmstate:
              guest.type === "qemu" && running && vmstate ? 1 : undefined,
          },
        );
        // A snapshot with RAM can take minutes: the task list follows it.
        void track(
          upid,
          t("snapshots.takeLabel", { name, vmid: guest.vmid }),
        ).then(onDone);
      }}
    >
      {(fieldError) => (
        <>
          <Field
            label={t("snapshots.name")}
            hint={t("snapshots.nameHint")}
            error={
              fieldError("snapname") ??
              (problem ? t(`snapshots.problem.${problem}`) : undefined)
            }
          >
            <TextInput value={name} onChange={setName} />
          </Field>
          <Field label={t("snapshots.description")}>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="text-xs"
            />
          </Field>
          {guest.type === "qemu" && running && (
            <CheckField
              label={t("snapshots.vmstate")}
              hint={t("snapshots.vmstateHint")}
              checked={vmstate}
              onChange={setVmstate}
            />
          )}
        </>
      )}
    </FormDialog>
  );
}

function DescriptionDialog({
  guest,
  snapshot,
  onClose,
  onDone,
}: {
  guest: GuestRef;
  snapshot: Snapshot;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [description, setDescription] = useState(
    snapshot.description?.trim() ?? "",
  );
  return (
    <FormDialog
      title={t("snapshots.editTitle", { name: snapshot.name })}
      submitLabel={t("app.save")}
      onClose={onClose}
      onSubmit={async () => {
        await pve(
          guest.hostId,
          "PUT",
          guestPath(guest, "snapshot", snapshot.name, "config"),
          { description },
        );
        onDone();
      }}
    >
      {() => (
        <Field label={t("snapshots.description")}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="text-xs"
          />
        </Field>
      )}
    </FormDialog>
  );
}

/** A guest's snapshots, as Proxmox's Snapshots panel: take, roll back, describe and delete. */
export function SnapshotsTab({
  guest,
  running,
  isVisible,
}: {
  guest: GuestRef;
  running: boolean;
  isVisible: boolean;
}) {
  const { t, language } = useTranslation();
  const toast = useToast();
  const { track } = useTasks();
  const [list, setList] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [editing, setEditing] = useState<Snapshot | null>(null);

  const load = useCallback(async () => {
    try {
      setList(
        (await pve<Snapshot[]>(
          guest.hostId,
          "GET",
          guestPath(guest, "snapshot"),
        )) ?? [],
      );
      setError(null);
    } catch (err) {
      setError(toCallError(err).message);
    }
    // guest fields are what the path uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest.hostId, guest.node, guest.type, guest.vmid]);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  const run = async (
    snapshot: Snapshot,
    kind: "rollback" | "delete",
  ): Promise<void> => {
    const ok = await app().confirm({
      title: t(`snapshots.${kind}Title`, { name: snapshot.name }),
      description: t(`snapshots.${kind}Description`, {
        name: snapshot.name,
        vmid: guest.vmid,
      }),
      confirmLabel: t(`snapshots.${kind}`),
    });
    if (!ok) return;
    try {
      const upid =
        kind === "rollback"
          ? await pve(
              guest.hostId,
              "POST",
              guestPath(guest, "snapshot", snapshot.name, "rollback"),
            )
          : await pve(
              guest.hostId,
              "DELETE",
              guestPath(guest, "snapshot", snapshot.name),
            );
      void track(
        upid,
        t(`snapshots.${kind}Label`, { name: snapshot.name, vmid: guest.vmid }),
      ).then(load);
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };

  const snapshots = (list ?? []).filter((s) => s.name !== CURRENT);
  const when = (seconds?: number) =>
    seconds
      ? new Date(seconds * 1000).toLocaleString(language, {
          dateStyle: "short",
          timeStyle: "short",
        })
      : "";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setTaking(true)}>
          <Camera className="mr-1 size-3.5" />
          {t("snapshots.take")}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {t("snapshots.hint")}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!list && !error && (
        <p className="text-xs text-muted-foreground">{t("app.loading")}</p>
      )}
      {list && snapshots.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("snapshots.none")}</p>
      )}
      {list &&
        snapshots.length > 0 &&
        snapshotTree(list).map(({ snapshot, depth }) => {
          const current = snapshot.name === CURRENT;
          return (
            <div
              key={snapshot.name}
              className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
              style={{ paddingLeft: `${depth * 14}px` }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {current ? t("snapshots.now") : snapshot.name}
                  </span>
                  {snapshot.vmstate ? (
                    <Badge variant="outline">{t("snapshots.withRam")}</Badge>
                  ) : null}
                </div>
                {/* "current" carries Proxmox's own "You are here!", untranslatable. */}
                {!current &&
                  (snapshot.description?.trim() || snapshot.snaptime) && (
                    <div className="truncate text-[11px] text-muted-foreground">
                      {[when(snapshot.snaptime), snapshot.description?.trim()]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
              </div>
              {!current && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2"
                    onClick={() => void run(snapshot, "rollback")}
                  >
                    <RotateCcw className="mr-1 size-3" />
                    {t("snapshots.rollback")}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5"
                        aria-label={t("guests.more")}
                      >
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditing(snapshot)}>
                        {t("snapshots.editDescription")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => void run(snapshot, "delete")}
                      >
                        {t("snapshots.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          );
        })}
      {taking && list && (
        <TakeDialog
          guest={guest}
          running={running}
          existing={list}
          onClose={() => setTaking(false)}
          onDone={load}
        />
      )}
      {editing && (
        <DescriptionDialog
          guest={guest}
          snapshot={editing}
          onClose={() => setEditing(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
