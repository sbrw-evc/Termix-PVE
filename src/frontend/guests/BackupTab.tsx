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
import { Archive, MoreHorizontal } from "lucide-react";
import { app, pve, toCallError } from "../api";
import { formatBytes } from "../format";
import { useTasks } from "../tasks";
import {
  CheckField,
  Field,
  FormDialog,
  SelectInput,
  TextInput,
} from "../components/forms";
import { backupLabel } from "../datacenter/backup";
import type { GuestRef } from "./useGuestConfig";

export interface GuestBackup {
  volid: string;
  storage: string;
  ctime?: number;
  size?: number;
  notes?: string;
  protected?: number;
  format?: string;
}

/** The params of a restore: a create of the guest type with the archive. */
export function restoreParams(
  type: GuestRef["type"],
  volid: string,
  vmid: number,
  options: {
    storage?: string;
    overwrite: boolean;
    unique: boolean;
    start: boolean;
  },
) {
  return {
    vmid,
    ...(type === "qemu"
      ? { archive: volid }
      : { ostemplate: volid, restore: 1 }),
    storage: options.storage || undefined,
    force: options.overwrite ? 1 : undefined,
    unique: options.unique ? 1 : undefined,
    start: options.start ? 1 : undefined,
  };
}

function BackupNowDialog({
  guest,
  storages,
  onClose,
  onDone,
}: {
  guest: GuestRef;
  storages: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [storage, setStorage] = useState(storages[0] ?? "");
  const [mode, setMode] = useState("snapshot");
  const [compress, setCompress] = useState("zstd");
  const [notes, setNotes] = useState("{{guestname}}");
  const [isProtected, setProtected] = useState(false);
  return (
    <FormDialog
      title={t("backup.nowTitle", { vmid: guest.vmid })}
      submitLabel={t("backup.now")}
      canSubmit={!!storage}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          guest.hostId,
          "POST",
          ["nodes", guest.node, "vzdump"],
          {
            vmid: guest.vmid,
            storage,
            mode,
            compress,
            "notes-template": notes || undefined,
            protected: isProtected ? 1 : undefined,
            remove: 0,
          },
        );
        void track(upid, t("backup.nowLabel", { vmid: guest.vmid })).then(
          onDone,
        );
      }}
    >
      {() => (
        <>
          <Field label={t("backup.job.storage")}>
            <SelectInput
              value={storage}
              onChange={setStorage}
              options={storages.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label={t("backup.job.mode")} hint={t("backup.modeHint")}>
            <SelectInput
              value={mode}
              onChange={setMode}
              options={["snapshot", "suspend", "stop"].map((value) => ({
                value,
                label: t(`backup.modes.${value}`),
              }))}
            />
          </Field>
          <Field label={t("backup.job.compress")}>
            <SelectInput
              value={compress}
              onChange={setCompress}
              options={["zstd", "lzo", "gzip", "0"].map((value) => ({
                value,
                label: value === "0" ? t("backup.noCompression") : value,
              }))}
            />
          </Field>
          <Field label={t("backup.job.notes")} hint={t("backup.job.notesHint")}>
            <TextInput value={notes} onChange={setNotes} />
          </Field>
          <CheckField
            label={t("backup.protected")}
            hint={t("backup.protectedHint")}
            checked={isProtected}
            onChange={setProtected}
          />
        </>
      )}
    </FormDialog>
  );
}

function RestoreDialog({
  guest,
  backup,
  running,
  onClose,
}: {
  guest: GuestRef;
  backup: GuestBackup;
  running: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [target, setTarget] = useState<"same" | "new">("new");
  const [vmid, setVmid] = useState("");
  const [storage, setStorage] = useState("");
  const [unique, setUnique] = useState(true);
  const [start, setStart] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  useEffect(() => {
    void pve<number>(guest.hostId, "GET", ["cluster", "nextid"]).then(
      (id) => setVmid(String(id)),
      () => undefined,
    );
    // Storages that hold this kind of disk. A container restore needs one
    // named: left out, Proxmox picks "local", which can't hold its disks.
    void pve<Array<{ storage: string; active?: number }>>(
      guest.hostId,
      "GET",
      ["nodes", guest.node, "storage"],
      { content: guest.type === "lxc" ? "rootdir" : "images", enabled: 1 },
    ).then(
      (list) => {
        const names = (list ?? [])
          .filter((s) => s.active !== 0)
          .map((s) => s.storage)
          .sort();
        setTargets(names);
        if (guest.type === "lxc") {
          setStorage(
            (current) =>
              current ||
              (names.includes("local-lvm") ? "local-lvm" : names[0]) ||
              "",
          );
        }
      },
      () => undefined,
    );
  }, [guest.hostId, guest.node, guest.type]);
  const id = target === "same" ? guest.vmid : Number(vmid);
  return (
    <FormDialog
      title={t("backup.restoreTitle", { name: backupLabel(backup.volid) })}
      submitLabel={t("backup.restore")}
      destructive={target === "same"}
      canSubmit={
        Number.isInteger(id) &&
        id >= 100 &&
        !(target === "same" && running) &&
        (guest.type === "qemu" || !!storage)
      }
      onClose={onClose}
      onSubmit={async () => {
        if (target === "same") {
          const ok = await app().confirm({
            title: t("backup.overwriteTitle", { vmid: guest.vmid }),
            description: t("backup.overwriteDescription", { vmid: guest.vmid }),
            confirmLabel: t("backup.restore"),
          });
          if (!ok) throw new Error(t("backup.notRestored"));
        }
        const upid = await pve(
          guest.hostId,
          "POST",
          ["nodes", guest.node, guest.type],
          restoreParams(guest.type, backup.volid, id, {
            storage,
            overwrite: target === "same",
            unique,
            start,
          }),
        );
        void track(upid, t("backup.restoreLabel", { vmid: id }));
      }}
    >
      {() => (
        <>
          <Field label={t("backup.restoreTarget")}>
            <SelectInput
              value={target}
              onChange={(v) => setTarget(v as "same" | "new")}
              options={[
                { value: "new", label: t("backup.restoreNew") },
                {
                  value: "same",
                  label: t("backup.restoreSame", { vmid: guest.vmid }),
                },
              ]}
            />
          </Field>
          {target === "same" && (
            <p className="text-[11px] text-destructive">
              {t(running ? "backup.stopFirst" : "backup.overwriteWarning", {
                vmid: guest.vmid,
              })}
            </p>
          )}
          {target === "new" && (
            <Field label={t("backup.newId")}>
              <TextInput type="number" value={vmid} onChange={setVmid} />
            </Field>
          )}
          <Field
            label={t("backup.restoreStorage")}
            hint={
              guest.type === "qemu" ? t("backup.restoreStorageHint") : undefined
            }
          >
            <SelectInput
              value={storage}
              onChange={setStorage}
              placeholder={
                guest.type === "qemu" ? t("backup.fromBackup") : undefined
              }
              options={targets.map((name) => ({ value: name, label: name }))}
            />
          </Field>
          {guest.type === "qemu" && (
            <CheckField
              label={t("backup.unique")}
              hint={t("backup.uniqueHint")}
              checked={unique}
              onChange={setUnique}
            />
          )}
          <CheckField
            label={t("backup.startAfter")}
            checked={start}
            onChange={setStart}
          />
        </>
      )}
    </FormDialog>
  );
}

function NotesDialog({
  guest,
  backup,
  onClose,
  onDone,
}: {
  guest: GuestRef;
  backup: GuestBackup;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState(backup.notes ?? "");
  return (
    <FormDialog
      title={t("backup.notesTitle", { name: backupLabel(backup.volid) })}
      submitLabel={t("app.save")}
      onClose={onClose}
      onSubmit={async () => {
        await pve(
          guest.hostId,
          "PUT",
          [
            "nodes",
            guest.node,
            "storage",
            backup.storage,
            "content",
            backup.volid,
          ],
          { notes },
        );
        onDone();
      }}
    >
      {() => (
        <Field label={t("backup.notes")}>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="text-xs"
          />
        </Field>
      )}
    </FormDialog>
  );
}

/** A guest's backups on every backup storage of its node, as Proxmox's Backup panel. */
export function BackupTab({
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
  const [storages, setStorages] = useState<string[]>([]);
  const [list, setList] = useState<GuestBackup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    { kind: "now" } | { kind: "restore" | "notes"; backup: GuestBackup } | null
  >(null);

  const load = useCallback(async () => {
    try {
      const stores = (
        (await pve<Array<{ storage: string; active?: number }>>(
          guest.hostId,
          "GET",
          ["nodes", guest.node, "storage"],
          {
            content: "backup",
            enabled: 1,
          },
        )) ?? []
      )
        .filter((s) => s.active !== 0)
        .map((s) => s.storage);
      setStorages(stores);
      const lists = await Promise.all(
        stores.map((storage) =>
          pve<GuestBackup[]>(
            guest.hostId,
            "GET",
            ["nodes", guest.node, "storage", storage, "content"],
            {
              content: "backup",
              vmid: guest.vmid,
            },
          )
            .then((items) => (items ?? []).map((b) => ({ ...b, storage })))
            .catch(() => []),
        ),
      );
      setList(lists.flat().sort((a, b) => (b.ctime ?? 0) - (a.ctime ?? 0)));
      setError(null);
    } catch (err) {
      setError(toCallError(err).message);
    }
  }, [guest.hostId, guest.node, guest.vmid]);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  const setProtected = async (backup: GuestBackup) => {
    try {
      await pve(
        guest.hostId,
        "PUT",
        [
          "nodes",
          guest.node,
          "storage",
          backup.storage,
          "content",
          backup.volid,
        ],
        {
          protected: backup.protected ? 0 : 1,
        },
      );
      void load();
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };

  const remove = async (backup: GuestBackup) => {
    const ok = await app().confirm({
      title: t("backup.deleteTitle", { name: backupLabel(backup.volid) }),
      description: t("backup.deleteDescription", { storage: backup.storage }),
      confirmLabel: t("crud.delete"),
    });
    if (!ok) return;
    try {
      const upid = await pve(guest.hostId, "DELETE", [
        "nodes",
        guest.node,
        "storage",
        backup.storage,
        "content",
        backup.volid,
      ]);
      if (typeof upid === "string" && upid.startsWith("UPID:"))
        await track(upid, t("backup.deleteLabel", { vmid: guest.vmid }));
      void load();
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!storages.length}
          onClick={() => setDialog({ kind: "now" })}
        >
          <Archive className="mr-1 size-3.5" />
          {t("backup.now")}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {storages.length
            ? t("backup.onStorages", { storages: storages.join(", ") })
            : t("backup.noStorage")}
        </span>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!list && !error && (
        <p className="text-xs text-muted-foreground">{t("app.loading")}</p>
      )}
      {list?.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("backup.none")}</p>
      )}
      {list?.map((backup) => (
        <div
          key={backup.volid}
          className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">
                {backup.ctime
                  ? new Date(backup.ctime * 1000).toLocaleString(language, {
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : backupLabel(backup.volid)}
              </span>
              {backup.protected ? (
                <Badge variant="secondary">{t("backup.protected")}</Badge>
              ) : null}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {[backup.storage, formatBytes(backup.size), backup.notes]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2"
            onClick={() => setDialog({ kind: "restore", backup })}
          >
            {t("backup.restore")}
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
              <DropdownMenuItem
                onClick={() => setDialog({ kind: "notes", backup })}
              >
                {t("backup.editNotes")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void setProtected(backup)}>
                {t(backup.protected ? "backup.unprotect" : "backup.protect")}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                disabled={!!backup.protected}
                onClick={() => void remove(backup)}
              >
                {t("crud.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
      {dialog?.kind === "now" && (
        <BackupNowDialog
          guest={guest}
          storages={storages}
          onClose={() => setDialog(null)}
          onDone={load}
        />
      )}
      {dialog?.kind === "restore" && (
        <RestoreDialog
          guest={guest}
          backup={dialog.backup}
          running={running}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "notes" && (
        <NotesDialog
          guest={guest}
          backup={dialog.backup}
          onClose={() => setDialog(null)}
          onDone={load}
        />
      )}
    </div>
  );
}
