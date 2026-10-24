import { useEffect, useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  GroupHeading,
  PasswordInput,
  Textarea,
} from "@termix-ssh/plugin-sdk/ui";
import { pve, toCallError } from "../../api";
import { Field, SelectInput, TextInput } from "../../components/forms";
import { StoragePicker } from "../../components/pickers";
import { cloudInitDrive, nextFreeKey } from "../config";
import {
  guestPath,
  setConfig,
  useGuestConfig,
  type GuestRef,
} from "../useGuestConfig";
import { cloudInitChanges, cloudInitForm, type CloudInitForm } from "./params";

export function CloudInitTab({
  guest,
  isVisible,
}: {
  guest: GuestRef;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { config, error, reload } = useGuestConfig(guest, isVisible);
  const [form, setForm] = useState<CloudInitForm | null>(null);
  const [storage, setStorage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (config) setForm(cloudInitForm(config));
  }, [config]);

  if (error) return <p className="py-2 text-xs text-destructive">{error}</p>;
  if (!config || !form)
    return (
      <p className="py-2 text-xs text-muted-foreground">{t("app.loading")}</p>
    );

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      await reload();
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const drive = cloudInitDrive(config);
  if (!drive) {
    const slot = nextFreeKey(config, "ide", 3);
    return (
      <div className="flex max-w-md flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          {t("cloudinit.noDrive")}
        </p>
        <StoragePicker
          hostId={guest.hostId}
          node={guest.node}
          content="images"
          value={storage}
          onChange={setStorage}
        />
        <Button
          size="sm"
          disabled={!storage || !slot || busy}
          onClick={() =>
            void run(
              () =>
                setConfig(
                  guest,
                  { [slot!]: `${storage}:cloudinit` },
                  config.digest,
                ),
              t("cloudinit.driveAdded"),
            )
          }
        >
          {t("cloudinit.addDrive")}
        </Button>
      </div>
    );
  }

  const initial = cloudInitForm(config);
  const changes = cloudInitChanges(initial, form);
  const set = (patch: Partial<CloudInitForm>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <GroupHeading title={t("cloudinit.user")} />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={t("cloudinit.username")}
          hint={t("cloudinit.usernameHint")}
        >
          <TextInput
            value={form.user}
            onChange={(user) => set({ user })}
            placeholder="debian"
          />
        </Field>
        <Field
          label={t("cloudinit.password")}
          hint={t("cloudinit.passwordHint")}
        >
          <PasswordInput
            className="h-8 text-xs"
            value={form.password}
            autoComplete="new-password"
            onChange={(e) => set({ password: e.target.value })}
          />
        </Field>
      </div>
      <Field label={t("guests.fields.sshKeys")}>
        <Textarea
          className="h-20 font-mono text-[11px]"
          value={form.sshKeys}
          onChange={(e) => set({ sshKeys: e.target.value })}
          placeholder="ssh-ed25519 AAAA..."
        />
      </Field>

      <GroupHeading title={t("cloudinit.network")} />
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("guests.fields.ipv4")}>
          <SelectInput
            value={form.ipMode}
            onChange={(v) => set({ ipMode: v as CloudInitForm["ipMode"] })}
            options={["dhcp", "static", "none"].map((v) => ({
              value: v,
              label: t(`hardware.nic.ip.${v}`),
            }))}
          />
        </Field>
        {form.ipMode === "static" && (
          <>
            <Field label={t("guests.fields.cidr")}>
              <TextInput
                value={form.cidr}
                onChange={(cidr) => set({ cidr })}
                placeholder="192.168.0.60/24"
              />
            </Field>
            <Field label={t("guests.fields.gateway")}>
              <TextInput
                value={form.gateway}
                onChange={(gateway) => set({ gateway })}
                placeholder="192.168.0.1"
              />
            </Field>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("options.nameserver")} hint={t("options.useHost")}>
          <TextInput
            value={form.nameserver}
            onChange={(nameserver) => set({ nameserver })}
          />
        </Field>
        <Field label={t("options.searchdomain")} hint={t("options.useHost")}>
          <TextInput
            value={form.searchdomain}
            onChange={(searchdomain) => set({ searchdomain })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || Object.keys(changes).length === 0}
          onClick={() =>
            void run(
              () => setConfig(guest, changes, config.digest),
              t("cloudinit.saved"),
            )
          }
        >
          {busy ? t("app.working") : t("app.save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(
              () => pve(guest.hostId, "PUT", guestPath(guest, "cloudinit")),
              t("cloudinit.regenerated"),
            )
          }
        >
          {t("cloudinit.regenerate")}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {t("cloudinit.regenerateHint", { drive })}
        </span>
      </div>
    </div>
  );
}
