import { useEffect, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { pve } from "../api";
import { formatBytes } from "../format";
import { useTasks } from "../tasks";
import {
  CheckField,
  Field,
  FormDialog,
  SelectInput,
  TextInput,
} from "../components/forms";
import type { DiskStorageKind } from "./DiskStorage";
import {
  ZFS_COMPRESSION,
  ZFS_MIN_DISKS,
  ZFS_RAIDS,
  diskStorageParams,
  diskStorageProblem,
  emptyDiskStorageForm,
  removeParams,
  unusedDisks,
  type DiskStorageForm,
  type ListedDisk,
  type ZfsRaid,
} from "./diskCreate";

/** Creates a volume group, thin pool, directory or ZFS pool on unused disks. */
export function CreateDiskStorageDialog({
  kind,
  hostId,
  node,
  onClose,
  onDone,
}: {
  kind: DiskStorageKind;
  hostId: number;
  node: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [disks, setDisks] = useState<ListedDisk[] | null>(null);
  const [form, setForm] = useState<DiskStorageForm>(emptyDiskStorageForm);
  const set = (patch: Partial<DiskStorageForm>) =>
    setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    pve<ListedDisk[]>(hostId, "GET", ["nodes", node, "disks", "list"]).then(
      (list) => setDisks(unusedDisks(list)),
      () => setDisks([]),
    );
  }, [hostId, node]);

  const problem = diskStorageProblem(kind, form);
  const label = (d: ListedDisk) =>
    [d.devpath, d.model, formatBytes(d.size)].filter(Boolean).join(" · ");

  return (
    <FormDialog
      title={t(`nodes.disks.storage.create.${kind}`)}
      submitLabel={t("nodes.disks.storage.createSubmit")}
      destructive
      canSubmit={!problem}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve<string>(
          hostId,
          "POST",
          ["nodes", node, "disks", kind],
          diskStorageParams(kind, form),
        );
        void track(
          upid,
          t("nodes.disks.storage.createLabel", { name: form.name, node }),
        ).then(onDone);
      }}
    >
      {(fieldError) => (
        <>
          <p className="text-[11px] text-destructive">
            {t("nodes.disks.storage.wipeWarning")}
          </p>
          <Field
            label={t("nodes.disks.storage.name")}
            error={fieldError("name")}
          >
            <TextInput
              value={form.name}
              onChange={(name) => set({ name })}
              placeholder={kind === "zfs" ? "tank" : "data2"}
            />
          </Field>
          {disks === null ? (
            <p className="text-xs text-muted-foreground">{t("app.loading")}</p>
          ) : disks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("nodes.disks.storage.noUnused")}
            </p>
          ) : kind === "zfs" ? (
            <Field
              label={t("nodes.disks.storage.devices")}
              error={fieldError("devices")}
            >
              <div className="flex flex-col gap-1 border border-border/60 p-2">
                {disks.map((d) => (
                  <CheckField
                    key={d.devpath}
                    label={label(d)}
                    checked={form.devices.includes(d.devpath)}
                    onChange={(on) =>
                      set({
                        devices: on
                          ? [...form.devices, d.devpath]
                          : form.devices.filter((x) => x !== d.devpath),
                      })
                    }
                  />
                ))}
              </div>
            </Field>
          ) : (
            <Field
              label={t("nodes.disks.storage.device")}
              error={fieldError("device")}
            >
              <SelectInput
                value={form.devices[0] ?? ""}
                placeholder={t("nodes.disks.storage.pickDisk")}
                onChange={(v) => set({ devices: v ? [v] : [] })}
                options={disks.map((d) => ({
                  value: d.devpath,
                  label: label(d),
                }))}
              />
            </Field>
          )}
          {kind === "directory" && (
            <Field label={t("nodes.disks.storage.filesystem")}>
              <SelectInput
                value={form.filesystem}
                onChange={(v) => set({ filesystem: v as "ext4" | "xfs" })}
                options={["ext4", "xfs"].map((v) => ({ value: v, label: v }))}
              />
            </Field>
          )}
          {kind === "zfs" && (
            <div className="grid grid-cols-3 gap-3">
              <Field label={t("nodes.disks.storage.raidlevel")}>
                <SelectInput
                  value={form.raidlevel}
                  onChange={(v) => set({ raidlevel: v as ZfsRaid })}
                  options={ZFS_RAIDS.map((v) => ({
                    value: v,
                    label: `${t(`nodes.disks.storage.raid.${v}`)} (${ZFS_MIN_DISKS[v]}+)`,
                  }))}
                />
              </Field>
              <Field label={t("nodes.disks.storage.compression")}>
                <SelectInput
                  value={form.compression}
                  onChange={(v) =>
                    set({ compression: v as DiskStorageForm["compression"] })
                  }
                  options={ZFS_COMPRESSION.map((v) => ({ value: v, label: v }))}
                />
              </Field>
              <Field label="ashift" error={fieldError("ashift")}>
                <TextInput
                  type="number"
                  min={9}
                  max={16}
                  value={form.ashift}
                  onChange={(ashift) => set({ ashift })}
                />
              </Field>
            </div>
          )}
          <CheckField
            label={t("nodes.disks.storage.addStorage")}
            hint={t("nodes.disks.storage.addStorageHint")}
            checked={form.addStorage}
            onChange={(addStorage) => set({ addStorage })}
          />
          {problem && form.name && (
            <p className="text-[11px] text-destructive">
              {t(`nodes.disks.storage.problem.${problem}`, {
                count: ZFS_MIN_DISKS[form.raidlevel],
              })}
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}

export interface RemoveTarget {
  name: string;
  /** The volume group of an LVM-Thin pool. */
  volumeGroup?: string;
}

/**
 * Removes one, optionally with its storage entry and wiping its disks. Wiping
 * asks for the name typed, as it cannot be undone.
 */
export function RemoveDiskStorageDialog({
  kind,
  hostId,
  node,
  target,
  onClose,
  onDone,
}: {
  kind: DiskStorageKind;
  hostId: number;
  node: string;
  target: RemoveTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [cleanupConfig, setCleanupConfig] = useState(true);
  const [cleanupDisks, setCleanupDisks] = useState(false);
  const [typed, setTyped] = useState("");
  const shown = target.volumeGroup
    ? `${target.volumeGroup}/${target.name}`
    : target.name;
  return (
    <FormDialog
      title={t("nodes.disks.storage.removeTitle", { name: shown })}
      submitLabel={t("nodes.disks.storage.remove")}
      destructive
      canSubmit={typed === target.name}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve<string>(
          hostId,
          "DELETE",
          ["nodes", node, "disks", kind, target.name],
          removeParams(
            kind,
            { cleanupConfig, cleanupDisks },
            target.volumeGroup,
          ),
        );
        void track(
          upid,
          t("nodes.disks.storage.removeLabel", { name: shown, node }),
        ).then(onDone);
      }}
    >
      {() => (
        <>
          <p className="text-[11px] text-muted-foreground">
            {t("nodes.disks.storage.removeWarning")}
          </p>
          <CheckField
            label={t("nodes.disks.storage.cleanupConfig")}
            checked={cleanupConfig}
            onChange={setCleanupConfig}
          />
          <CheckField
            label={t("nodes.disks.storage.cleanupDisks")}
            hint={t("nodes.disks.storage.cleanupDisksHint")}
            checked={cleanupDisks}
            onChange={setCleanupDisks}
          />
          <Field label={t("nodes.power.typeName", { node: target.name })}>
            <TextInput
              value={typed}
              onChange={setTyped}
              placeholder={target.name}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

/** Wipes a disk's partition table and signatures, after its path is typed. */
export function WipeDiskDialog({
  hostId,
  node,
  disk,
  onClose,
  onDone,
}: {
  hostId: number;
  node: string;
  disk: ListedDisk;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [typed, setTyped] = useState("");
  return (
    <FormDialog
      title={t("nodes.disks.wipeTitle", { disk: disk.devpath })}
      submitLabel={t("nodes.disks.wipe")}
      destructive
      canSubmit={typed === disk.devpath}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve<string>(
          hostId,
          "PUT",
          ["nodes", node, "disks", "wipedisk"],
          { disk: disk.devpath },
        );
        void track(
          upid,
          t("nodes.disks.wipeLabel", { disk: disk.devpath, node }),
        ).then(onDone);
      }}
    >
      {() => (
        <>
          <p className="text-[11px] text-destructive">
            {t("nodes.disks.wipeWarning", {
              used: disk.used ?? t("nodes.disks.unused"),
            })}
          </p>
          <Field label={t("nodes.disks.typePath", { disk: disk.devpath })}>
            <TextInput
              value={typed}
              onChange={setTyped}
              placeholder={disk.devpath}
            />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
