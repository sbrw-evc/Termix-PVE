import { useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Button, GroupHeading, Textarea } from "@termix-ssh/plugin-sdk/ui";
import { Pencil } from "lucide-react";
import { pve } from "../api";
import { Fact } from "../components/Usage";
import {
  CheckField,
  Field,
  FormDialog,
  SelectInput,
  TextInput,
} from "../components/forms";
import { useApiList } from "./crud";
import type { DatacenterProps } from "./DatacenterView";
import {
  KEYBOARDS,
  LANGUAGES,
  dcOptionsForm,
  dcOptionsParams,
  dcOptionsProblem,
  parseProps,
  type DcOptionsForm,
} from "./options";

/** The datacenter's notes and options, as Proxmox's Datacenter > Options. */
export function OptionsPanel({ hostId, isVisible }: DatacenterProps) {
  const { t } = useTranslation();
  const {
    data,
    error,
    load: reload,
  } = useApiList<Record<string, unknown>>(
    hostId,
    ["cluster", "options"],
    undefined,
    isVisible,
  );
  const [dialog, setDialog] = useState<"notes" | "options" | null>(null);
  const options = (data ?? null) as Record<string, unknown> | null;
  const migration = parseProps(options?.migration, "type");
  const dash = (v: unknown) =>
    v === undefined || v === null || v === ""
      ? t("dcOptions.default")
      : String(v);

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <section className="flex flex-col gap-1">
        <GroupHeading
          title={t("dcOptions.notes")}
          action={
            options ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setDialog("notes")}
              >
                <Pencil className="mr-1 size-3" />
                {t("app.edit")}
              </Button>
            ) : null
          }
        />
        {options && (
          <pre className="min-h-10 whitespace-pre-wrap border border-border/60 bg-muted/20 p-2 text-xs">
            {String(options.description ?? "") || t("dcOptions.noNotes")}
          </pre>
        )}
      </section>
      <section className="flex flex-col gap-1">
        <GroupHeading
          title={t("dcOptions.title")}
          action={
            options ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setDialog("options")}
              >
                <Pencil className="mr-1 size-3" />
                {t("app.edit")}
              </Button>
            ) : null
          }
        />
        {options && (
          <>
            <Fact label={t("dcOptions.keyboard")}>
              {dash(options.keyboard)}
            </Fact>
            <Fact label={t("dcOptions.language")}>
              {dash(options.language)}
            </Fact>
            <Fact label={t("dcOptions.console")}>{dash(options.console)}</Fact>
            <Fact label={t("dcOptions.emailFrom")}>
              {dash(options.email_from)}
            </Fact>
            <Fact label={t("dcOptions.httpProxy")}>
              {dash(options.http_proxy)}
            </Fact>
            <Fact label={t("dcOptions.macPrefix")}>
              {dash(options.mac_prefix)}
            </Fact>
            <Fact label={t("dcOptions.maxWorkers")}>
              {dash(options.max_workers)}
            </Fact>
            <Fact label={t("dcOptions.migration")}>
              {migration.type
                ? [migration.type, migration.network]
                    .filter(Boolean)
                    .join(" · ")
                : t("dcOptions.default")}
            </Fact>
            <Fact label={t("dcOptions.bwlimit")}>{dash(options.bwlimit)}</Fact>
            <Fact label={t("dcOptions.nextId")}>
              {dash(options["next-id"])}
            </Fact>
            <Fact label={t("dcOptions.haShutdown")}>
              {dash(parseProps(options.ha).shutdown_policy)}
            </Fact>
          </>
        )}
      </section>
      {dialog === "notes" && options && (
        <NotesDialog
          hostId={hostId}
          notes={String(options.description ?? "")}
          onClose={() => setDialog(null)}
          onDone={reload}
        />
      )}
      {dialog === "options" && options && (
        <OptionsDialog
          hostId={hostId}
          options={options}
          onClose={() => setDialog(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}

function NotesDialog({
  hostId,
  notes,
  onClose,
  onDone,
}: {
  hostId: number;
  notes: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [text, setText] = useState(notes);
  return (
    <FormDialog
      title={t("dcOptions.notesTitle")}
      submitLabel={t("app.save")}
      canSubmit={text !== notes}
      wide
      onClose={onClose}
      onSubmit={async () => {
        await pve(
          hostId,
          "PUT",
          ["cluster", "options"],
          text.trim() ? { description: text } : { delete: "description" },
        );
        toast.success(t("dcOptions.saved"));
        onDone();
      }}
    >
      {() => (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="h-64 text-xs"
          placeholder={t("dcOptions.notesHint")}
        />
      )}
    </FormDialog>
  );
}

function OptionsDialog({
  hostId,
  options,
  onClose,
  onDone,
}: {
  hostId: number;
  options: Record<string, unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState<DcOptionsForm>(() => dcOptionsForm(options));
  const set = (patch: Partial<DcOptionsForm>) =>
    setForm((f) => ({ ...f, ...patch }));
  const problem = dcOptionsProblem(form);
  const pick = (values: string[]) => [
    { value: "", label: t("dcOptions.default") },
    ...values.map((value) => ({ value, label: value })),
  ];
  const text = (key: keyof DcOptionsForm, placeholder?: string) => (
    <TextInput
      value={String(form[key])}
      onChange={(v) => set({ [key]: v } as Partial<DcOptionsForm>)}
      placeholder={placeholder}
    />
  );

  return (
    <FormDialog
      title={t("dcOptions.editTitle")}
      submitLabel={t("app.save")}
      canSubmit={!problem}
      wide
      onClose={onClose}
      onSubmit={async () => {
        await pve(hostId, "PUT", ["cluster", "options"], dcOptionsParams(form));
        toast.success(t("dcOptions.saved"));
        onDone();
      }}
    >
      {() => (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("dcOptions.keyboard")}>
              <SelectInput
                value={form.keyboard}
                onChange={(keyboard) => set({ keyboard })}
                options={pick(KEYBOARDS)}
              />
            </Field>
            <Field label={t("dcOptions.language")}>
              <SelectInput
                value={form.language}
                onChange={(language) => set({ language })}
                options={pick(LANGUAGES)}
              />
            </Field>
            <Field label={t("dcOptions.console")}>
              <SelectInput
                value={form.console}
                onChange={(console) => set({ console })}
                options={pick(["html5", "xtermjs", "vv", "applet"])}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("dcOptions.emailFrom")}>
              {text("emailFrom", "root@pve.example.com")}
            </Field>
            <Field label={t("dcOptions.httpProxy")}>
              {text("httpProxy", "http://proxy:3128")}
            </Field>
            <Field label={t("dcOptions.macPrefix")}>
              {text("macPrefix", "BC:24:11")}
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("dcOptions.maxWorkers")}>
              {text("maxWorkers", "4")}
            </Field>
            <Field label={t("dcOptions.migrationType")}>
              <SelectInput
                value={form.migrationType}
                onChange={(migrationType) => set({ migrationType })}
                options={pick(["secure", "insecure"])}
              />
            </Field>
            <Field label={t("dcOptions.migrationNetwork")}>
              {text("migrationNetwork", "10.0.0.0/24")}
            </Field>
          </div>
          <Field
            label={t("dcOptions.bwlimit")}
            hint={t("dcOptions.bwlimitHint")}
          >
            <div className="grid grid-cols-5 gap-2">
              {(
                [
                  ["bwDefault", "default"],
                  ["bwMigration", "migration"],
                  ["bwClone", "clone"],
                  ["bwRestore", "restore"],
                  ["bwMove", "move"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground">
                    {t(`dcOptions.bw.${label}`)}
                  </span>
                  {text(key)}
                </div>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label={t("dcOptions.nextLower")}>
              {text("nextLower", "100")}
            </Field>
            <Field label={t("dcOptions.nextUpper")}>
              {text("nextUpper", "1000000")}
            </Field>
            <Field label={t("dcOptions.haShutdown")}>
              <SelectInput
                value={form.haShutdown}
                onChange={(haShutdown) => set({ haShutdown })}
                options={pick(["conditional", "freeze", "failover", "migrate"])}
              />
            </Field>
          </div>
          <CheckField
            label={t("dcOptions.tagCase")}
            checked={form.tagStyleCase}
            onChange={(tagStyleCase) => set({ tagStyleCase })}
          />
          {problem && (
            <p className="text-[11px] text-destructive">
              {t(`dcOptions.problem.${problem}`)}
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}
