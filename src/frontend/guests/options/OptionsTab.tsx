import { useEffect, useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Button, GroupHeading, Textarea } from "@termix-ssh/plugin-sdk/ui";
import { toCallError } from "../../api";
import {
  CheckField,
  Field,
  SelectInput,
  TextInput,
} from "../../components/forms";
import { setConfig, useGuestConfig, type GuestRef } from "../useGuestConfig";
import {
  optionsChanges,
  optionsForm,
  optionsProblem,
  type OptionsForm,
} from "./params";

const OS_TYPES = ["l26", "win11", "win10", "win8", "w2k8", "solaris", "other"];

export function OptionsTab({
  guest,
  isVisible,
}: {
  guest: GuestRef;
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { config, error, reload } = useGuestConfig(guest, isVisible);
  const [form, setForm] = useState<OptionsForm | null>(null);
  const [saving, setSaving] = useState(false);
  const qemu = guest.type === "qemu";

  const initial = config ? optionsForm(guest.type, config) : null;
  // A fresh config (after a save or elsewhere) resets the form.
  useEffect(() => {
    if (config) setForm(optionsForm(guest.type, config));
  }, [config, guest.type]);

  if (error) return <p className="py-2 text-xs text-destructive">{error}</p>;
  if (!config || !form || !initial) {
    return (
      <p className="py-2 text-xs text-muted-foreground">{t("app.loading")}</p>
    );
  }

  const set = (patch: Partial<OptionsForm>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));
  const changes = optionsChanges(guest.type, initial, form);
  const problem = optionsProblem(guest.type, form);
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await setConfig(guest, changes, config.digest);
      toast.success(t("options.saved"));
      await reload();
    } catch (err) {
      toast.error(toCallError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <GroupHeading title={t("options.general")} />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-3">
        <Field
          label={t(qemu ? "guests.fields.name" : "guests.fields.hostname")}
        >
          <TextInput value={form.name} onChange={(name) => set({ name })} />
        </Field>
        {qemu && (
          <Field label={t("guests.fields.ostype")}>
            <SelectInput
              value={form.ostype}
              onChange={(ostype) => set({ ostype })}
              options={(OS_TYPES.includes(form.ostype)
                ? OS_TYPES
                : [form.ostype, ...OS_TYPES]
              )
                .filter(Boolean)
                .map((v) => ({
                  value: v,
                  label: t(`options.ostype.${v}`, { defaultValue: v }),
                }))}
            />
          </Field>
        )}
        <Field label={t("options.tags")} hint={t("options.tagsHint")}>
          <TextInput
            value={form.tags}
            onChange={(tags) => set({ tags })}
            placeholder="web, prod"
          />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <CheckField
          label={t("options.onboot")}
          checked={form.onboot}
          onChange={(onboot) => set({ onboot })}
        />
        <CheckField
          label={t("options.protection")}
          hint={t("options.protectionHint")}
          checked={form.protection}
          onChange={(protection) => set({ protection })}
        />
        {qemu && (
          <CheckField
            label={t("options.agent")}
            hint={t("options.agentHint")}
            checked={form.agent}
            onChange={(agent) => set({ agent })}
          />
        )}
      </div>

      <GroupHeading title={t("options.startup")} />
      <div className="grid grid-cols-3 gap-3">
        <Field label={t("options.startupOrder")}>
          <TextInput
            type="number"
            value={form.startupOrder}
            onChange={(startupOrder) => set({ startupOrder })}
            min={0}
          />
        </Field>
        <Field label={t("options.startupUp")}>
          <TextInput
            type="number"
            value={form.startupUp}
            onChange={(startupUp) => set({ startupUp })}
            min={0}
          />
        </Field>
        <Field label={t("options.startupDown")}>
          <TextInput
            type="number"
            value={form.startupDown}
            onChange={(startupDown) => set({ startupDown })}
            min={0}
          />
        </Field>
      </div>

      {!qemu && (
        <>
          <GroupHeading title={t("options.dns")} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("options.nameserver")} hint={t("options.useHost")}>
              <TextInput
                value={form.nameserver}
                onChange={(nameserver) => set({ nameserver })}
                placeholder="1.1.1.1"
              />
            </Field>
            <Field
              label={t("options.searchdomain")}
              hint={t("options.useHost")}
            >
              <TextInput
                value={form.searchdomain}
                onChange={(searchdomain) => set({ searchdomain })}
              />
            </Field>
          </div>
        </>
      )}

      <GroupHeading title={t("options.notes")} />
      <Textarea
        className="min-h-24 text-xs"
        value={form.description}
        onChange={(e) => set({ description: e.target.value })}
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || !!problem || saving}
          onClick={() => void save()}
        >
          {saving ? t("app.working") : t("app.save")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || saving}
          onClick={() => setForm(initial)}
        >
          {t("app.reset")}
        </Button>
        {problem && (
          <span className="text-[11px] text-destructive">
            {t(`options.problem.${problem}`)}
          </span>
        )}
      </div>
    </div>
  );
}
