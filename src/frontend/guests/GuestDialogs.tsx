import { useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { pve, type GuestType, type PveResource } from "../api";
import { useTasks } from "../tasks";
import { guestLabel } from "../tree";
import {
  CheckField,
  Field,
  FormDialog,
  SelectInput,
  TextInput,
} from "../components/forms";
import { listNodes, listStorages, nextVmid, useLoad } from "./lookups";
import {
  cloneParams,
  deleteParams,
  isValidVmid,
  migrateParams,
} from "./params";

export interface GuestRef {
  hostId: number;
  guest: PveResource & { type: GuestType; node: string; vmid: number };
}

export function CloneDialog({
  hostId,
  guest,
  onClose,
}: GuestRef & { onClose: () => void }) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const nodes = useLoad(() => listNodes(hostId), [hostId]);
  const suggested = useLoad(() => nextVmid(hostId), [hostId]);
  const [newid, setNewid] = useState<string>("");
  const [name, setName] = useState(`${guest.name ?? guest.vmid}-clone`);
  const [target, setTarget] = useState(guest.node);
  // A template's linked clone shares its disks; anything else copies them.
  const [full, setFull] = useState(!guest.template);
  const [storage, setStorage] = useState("");
  const content = guest.type === "qemu" ? "images" : "rootdir";
  const storages = useLoad(
    () => listStorages(hostId, target, content),
    [hostId, target],
  );

  const id = Number(newid || suggested.data || 0);
  const label = t("guests.clone.label", { source: guestLabel(guest), id });

  return (
    <FormDialog
      title={t("guests.clone.title", { name: guestLabel(guest) })}
      submitLabel={t("guests.clone.submit")}
      canSubmit={isValidVmid(id) && !!target}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          hostId,
          "POST",
          ["nodes", guest.node, guest.type, guest.vmid, "clone"],
          cloneParams(guest.type, { newid: id, name, target, full, storage }),
        );
        void track(upid, label);
      }}
    >
      {(fieldError) => (
        <>
          <Field label={t("guests.fields.vmid")} error={fieldError("newid")}>
            <TextInput
              type="number"
              value={newid || (suggested.data ?? "")}
              onChange={setNewid}
              min={100}
            />
          </Field>
          <Field
            label={t(
              guest.type === "qemu"
                ? "guests.fields.name"
                : "guests.fields.hostname",
            )}
            error={fieldError(guest.type === "qemu" ? "name" : "hostname")}
          >
            <TextInput value={name} onChange={setName} />
          </Field>
          <Field
            label={t("guests.fields.targetNode")}
            error={fieldError("target")}
          >
            <SelectInput
              value={target}
              onChange={setTarget}
              options={(nodes.data ?? [guest.node]).map((n) => ({
                value: n,
                label: n,
              }))}
            />
          </Field>
          <CheckField
            label={t("guests.clone.full")}
            hint={t(
              guest.template
                ? "guests.clone.linkedHint"
                : "guests.clone.fullHint",
            )}
            checked={full}
            onChange={setFull}
          />
          {full && (
            <Field
              label={t("guests.fields.targetStorage")}
              error={fieldError("storage")}
            >
              <SelectInput
                value={storage}
                onChange={setStorage}
                placeholder={t("guests.clone.sameStorage")}
                options={(storages.data ?? []).map((s) => ({
                  value: s.storage,
                  label: s.storage,
                }))}
              />
            </Field>
          )}
        </>
      )}
    </FormDialog>
  );
}

export function MigrateDialog({
  hostId,
  guest,
  onClose,
}: GuestRef & { onClose: () => void }) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const nodes = useLoad(() => listNodes(hostId), [hostId]);
  const others = (nodes.data ?? []).filter((n) => n !== guest.node);
  const [target, setTarget] = useState("");
  const running = guest.status === "running";
  const chosen = target || others[0] || "";

  return (
    <FormDialog
      title={t("guests.migrate.title", { name: guestLabel(guest) })}
      submitLabel={t("guests.migrate.submit")}
      canSubmit={!!chosen}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          hostId,
          "POST",
          ["nodes", guest.node, guest.type, guest.vmid, "migrate"],
          migrateParams(guest.type, chosen, running),
        );
        void track(
          upid,
          t("guests.migrate.label", {
            name: guestLabel(guest),
            target: chosen,
          }),
        );
      }}
    >
      {(fieldError) =>
        nodes.data && others.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("guests.migrate.noOtherNodes")}
          </p>
        ) : (
          <>
            <Field
              label={t("guests.fields.targetNode")}
              error={fieldError("target")}
            >
              <SelectInput
                value={chosen}
                onChange={setTarget}
                options={others.map((n) => ({ value: n, label: n }))}
              />
            </Field>
            {running && (
              <p className="text-[11px] text-muted-foreground">
                {t(
                  guest.type === "qemu"
                    ? "guests.migrate.onlineHint"
                    : "guests.migrate.restartHint",
                )}
              </p>
            )}
          </>
        )
      }
    </FormDialog>
  );
}

export function DeleteDialog({
  hostId,
  guest,
  onClose,
}: GuestRef & { onClose: () => void }) {
  const { t } = useTranslation();
  const { track } = useTasks();
  const [typed, setTyped] = useState("");
  const [purge, setPurge] = useState(true);
  const [unreferenced, setUnreferenced] = useState(false);
  const running = guest.status === "running";

  return (
    <FormDialog
      title={t("guests.delete.title", { name: guestLabel(guest) })}
      submitLabel={t("guests.delete.submit")}
      destructive
      canSubmit={!running && typed === String(guest.vmid)}
      onClose={onClose}
      onSubmit={async () => {
        const upid = await pve(
          hostId,
          "DELETE",
          ["nodes", guest.node, guest.type, guest.vmid],
          deleteParams(purge, unreferenced),
        );
        void track(upid, t("guests.delete.label", { name: guestLabel(guest) }));
      }}
    >
      {() => (
        <>
          {running ? (
            <p className="text-xs text-destructive">
              {t("guests.delete.stopFirst")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("guests.delete.warning", { vmid: guest.vmid })}
            </p>
          )}
          <Field label={t("guests.delete.typeId", { vmid: guest.vmid })}>
            <TextInput
              value={typed}
              onChange={setTyped}
              placeholder={String(guest.vmid)}
            />
          </Field>
          <CheckField
            label={t("guests.delete.purge")}
            hint={t("guests.delete.purgeHint")}
            checked={purge}
            onChange={setPurge}
          />
          <CheckField
            label={t("guests.delete.unreferenced")}
            hint={t("guests.delete.unreferencedHint")}
            checked={unreferenced}
            onChange={setUnreferenced}
          />
        </>
      )}
    </FormDialog>
  );
}
