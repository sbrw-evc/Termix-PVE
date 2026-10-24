import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  GroupHeading,
  Textarea,
} from "@termix-ssh/plugin-sdk/ui";
import { MoreHorizontal, Plus } from "lucide-react";
import { app, pve, toCallError, type PveParams } from "../api";
import {
  CheckField,
  Field,
  FormDialog,
  SelectInput,
  TextInput,
} from "../components/forms";

/*
 * Most of Proxmox's datacenter panels are a list from one path and a dialog
 * of plain fields. These pieces draw them from a field list, so each panel
 * only says which fields it has and where they go.
 */

export type FieldKind =
  "text" | "number" | "password" | "textarea" | "select" | "check";

export type FormValues = Record<string, string | boolean>;

export interface FieldSpec {
  /** The Proxmox parameter name. */
  key: string;
  labelKey: string;
  kind?: FieldKind;
  hintKey?: string;
  options?: Array<{ value: string; label?: string; labelKey?: string }>;
  required?: boolean;
  /** The record's id: set on create, read only after. */
  createOnly?: boolean;
  /** Checked when not empty. */
  pattern?: RegExp;
  patternKey?: string;
  placeholder?: string;
  default?: string | boolean;
  /** Hides the field (and drops its value) when false. */
  showIf?: (values: FormValues) => boolean;
  /** Never sent: helper fields the panel turns into params itself. */
  local?: boolean;
  /** Only on create, such as a new user's first password. */
  hideOnEdit?: boolean;
}

const isChecked = (value: unknown) =>
  value === true || value === 1 || value === "1";

/** A form's values from a record, or the defaults for a new one. */
export function valuesFrom(
  fields: FieldSpec[],
  row?: Record<string, unknown> | null,
): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    const raw = row?.[field.key];
    if (field.kind === "check") {
      values[field.key] =
        raw === undefined ? field.default === true : isChecked(raw);
    } else if (raw === undefined || raw === null) {
      values[field.key] =
        typeof field.default === "string" && !row ? field.default : "";
    } else {
      values[field.key] = Array.isArray(raw) ? raw.join(",") : String(raw);
    }
  }
  return values;
}

const shown = (field: FieldSpec, values: FormValues) =>
  !field.showIf || field.showIf(values);

/** The first field that is wrong, with the key of its message. */
export function fieldProblem(
  fields: FieldSpec[],
  values: FormValues,
  creating: boolean,
): { key: string; messageKey: string } | null {
  for (const field of fields) {
    if (!shown(field, values) || field.kind === "check") continue;
    if (!creating && (field.createOnly || field.hideOnEdit)) continue;
    const value = String(values[field.key] ?? "").trim();
    if (!value) {
      if (field.required)
        return { key: field.key, messageKey: "crud.required" };
      continue;
    }
    if (field.kind === "number" && !Number.isFinite(Number(value))) {
      return { key: field.key, messageKey: "crud.number" };
    }
    if (field.pattern && !field.pattern.test(value)) {
      return { key: field.key, messageKey: field.patternKey ?? "crud.format" };
    }
  }
  return null;
}

/**
 * Params for a create (POST) or an update (PUT). Blank fields are left out
 * of a create; on an update they go into `delete`, so Proxmox clears them
 * instead of keeping the old value. Checkboxes are 1 or 0.
 */
export function paramsFrom(
  fields: FieldSpec[],
  values: FormValues,
  creating: boolean,
  options: { deleteParam?: boolean } = {},
): PveParams {
  const params: PveParams = {};
  const cleared: string[] = [];
  for (const field of fields) {
    if (field.local) continue;
    if (!creating && (field.createOnly || field.hideOnEdit)) continue;
    // A hidden field does not apply to this kind of record: leave it alone.
    if (!shown(field, values)) continue;
    const value = values[field.key];
    if (field.kind === "check") {
      params[field.key] = value === true ? 1 : 0;
      continue;
    }
    const text = String(value ?? "").trim();
    if (!text) {
      if (!creating) cleared.push(field.key);
      continue;
    }
    params[field.key] = field.kind === "number" ? Number(text) : text;
  }
  if (!creating && cleared.length && options.deleteParam !== false) {
    params.delete = cleared.join(",");
  }
  return params;
}

export function FieldInput({
  field,
  values,
  setValue,
  creating,
}: {
  field: FieldSpec;
  values: FormValues;
  setValue: (key: string, value: string | boolean) => void;
  creating: boolean;
}) {
  const { t } = useTranslation();
  const value = values[field.key];
  const disabled = !creating && field.createOnly;
  if (field.kind === "check") {
    return (
      <CheckField
        label={t(field.labelKey)}
        hint={field.hintKey ? t(field.hintKey) : undefined}
        checked={value === true}
        onChange={(checked) => setValue(field.key, checked)}
      />
    );
  }
  let input: ReactNode;
  if (field.kind === "select") {
    input = (
      <SelectInput
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(next) => setValue(field.key, next)}
        placeholder={field.required ? undefined : t("crud.notSet")}
        options={(field.options ?? []).map((o) => ({
          value: o.value,
          label: o.labelKey ? t(o.labelKey) : (o.label ?? o.value),
        }))}
      />
    );
  } else if (field.kind === "textarea") {
    input = (
      <Textarea
        value={String(value ?? "")}
        disabled={disabled}
        onChange={(e) => setValue(field.key, e.target.value)}
        placeholder={field.placeholder}
        rows={4}
        className="font-mono text-xs"
      />
    );
  } else {
    input = (
      <TextInput
        type={
          field.kind === "number" || field.kind === "password"
            ? field.kind
            : "text"
        }
        value={String(value ?? "")}
        disabled={disabled}
        placeholder={field.placeholder}
        onChange={(next) => setValue(field.key, next)}
      />
    );
  }
  return (
    <Field
      label={t(field.labelKey)}
      hint={field.hintKey ? t(field.hintKey) : undefined}
    >
      {input}
    </Field>
  );
}

export function RecordDialog({
  title,
  submitLabel,
  fields,
  initial,
  creating,
  intro,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel?: string;
  fields: FieldSpec[];
  initial: FormValues;
  creating: boolean;
  intro?: ReactNode;
  onSubmit: (values: FormValues) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<FormValues>(initial);
  const problem = fieldProblem(fields, values, creating);
  const setValue = (key: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [key]: value }));
  const visible = fields.filter(
    (f) => shown(f, values) && !(f.hideOnEdit && !creating),
  );
  return (
    <FormDialog
      title={title}
      submitLabel={submitLabel ?? t(creating ? "crud.create" : "app.save")}
      canSubmit={!problem}
      wide={visible.length > 5}
      onClose={onClose}
      onSubmit={() => onSubmit(values)}
    >
      {(fieldError) => (
        <>
          {intro}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visible.map((field) => (
              <div
                key={field.key}
                className={
                  field.kind === "textarea" || field.kind === "check"
                    ? "sm:col-span-2"
                    : undefined
                }
              >
                <FieldInput
                  field={field}
                  values={values}
                  setValue={setValue}
                  creating={creating}
                />
                {fieldError(field.key) && (
                  <span className="text-[11px] text-destructive">
                    {fieldError(field.key)}
                  </span>
                )}
              </div>
            ))}
          </div>
          {problem && (
            <p className="text-[11px] text-muted-foreground">
              {t(
                fields.find((f) => f.key === problem.key)?.labelKey ??
                  problem.key,
              )}
              : {t(problem.messageKey)}
            </p>
          )}
        </>
      )}
    </FormDialog>
  );
}

/** Loads one path while visible. */
export function useApiList<T>(
  hostId: number,
  path: Array<string | number>,
  params: PveParams | undefined,
  isVisible: boolean,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([hostId, path, params]);
  const load = useCallback(async () => {
    try {
      setData((await pve<T>(hostId, "GET", path, params)) ?? null);
      setError(null);
    } catch (err) {
      setError(toCallError(err).message);
    }
    // key holds everything the call uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);
  return { data, error, load, setData };
}

export interface RowView {
  title: ReactNode;
  detail?: ReactNode;
  badges?: ReactNode;
}

export interface CrudSectionProps<T> {
  hostId: number;
  isVisible: boolean;
  titleKey: string;
  hintKey?: string;
  emptyKey: string;
  listPath: Array<string | number>;
  listParams?: PveParams;
  /** Picks and orders the rows out of the answer. */
  rows?: (data: unknown) => T[];
  rowId: (row: T) => string;
  view: (row: T) => RowView;
  fields?: FieldSpec[];
  /** Where a new record is POSTed; the list path when left out. */
  createPath?: Array<string | number>;
  /** A create path that depends on the form, such as a user's tokens. */
  createPathFor?: (values: FormValues) => Array<string | number>;
  /** ACLs are created with PUT. */
  createMethod?: "POST" | "PUT";
  /** Shapes a record into form values the fields expect (derived fields). */
  prepare?: (row: Record<string, unknown>) => Record<string, unknown>;
  /** Replaces the DELETE call, for records removed another way. */
  onDelete?: (row: T) => Promise<void>;
  /** The record's own path, for PUT and DELETE. */
  itemPath?: (row: T) => Array<string | number>;
  /** Reads the full record before editing, when the list is short. */
  loadItem?: boolean;
  toParams?: (values: FormValues, creating: boolean, row?: T) => PveParams;
  createLabelKey?: string;
  dialogTitle?: (creating: boolean, row?: T) => string;
  canEdit?: (row: T) => boolean;
  canDelete?: (row: T) => boolean;
  deleteText?: (row: T) => { title: string; description: string };
  /** Extra items for a row's menu. */
  menu?: (row: T, reload: () => void) => ReactNode;
  /** Extra buttons next to Create. */
  toolbar?: (reload: () => void) => ReactNode;
  /** Runs after a create, with what Proxmox answered (a token's secret). */
  afterCreate?: (answer: unknown, values: FormValues) => void;
  readOnly?: boolean;
  /** Hands the loaded rows to the panel, for choices that depend on them. */
  onLoaded?: (rows: T[]) => void;
}

export function CrudSection<T extends Record<string, unknown>>(
  props: CrudSectionProps<T>,
) {
  const { t } = useTranslation();
  const toast = useToast();
  const {
    hostId,
    isVisible,
    listPath,
    listParams,
    fields = [],
    itemPath,
    readOnly,
  } = props;
  const { data, error, load } = useApiList<unknown>(
    hostId,
    listPath,
    listParams,
    isVisible,
  );
  const [dialog, setDialog] = useState<{
    row?: T;
    values: FormValues;
  } | null>(null);

  const list = data
    ? props.rows
      ? props.rows(data)
      : Array.isArray(data)
        ? (data as T[])
        : []
    : null;
  const { onLoaded } = props;
  useEffect(() => {
    if (list) onLoaded?.(list);
    // list is derived from data; data changing is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, onLoaded]);

  const openEdit = async (row: T) => {
    let full: Record<string, unknown> = row;
    if (props.loadItem && itemPath) {
      try {
        full = {
          ...row,
          ...((await pve<Record<string, unknown>>(
            hostId,
            "GET",
            itemPath(row),
          )) ?? {}),
        };
      } catch (err) {
        toast.error(toCallError(err).message);
        return;
      }
    }
    setDialog({
      row,
      values: valuesFrom(fields, props.prepare ? props.prepare(full) : full),
    });
  };

  const remove = async (row: T) => {
    if (!itemPath && !props.onDelete) return;
    const text = props.deleteText?.(row) ?? {
      title: t("crud.deleteTitle", { name: props.rowId(row) }),
      description: t("crud.deleteDescription"),
    };
    const ok = await app().confirm({
      title: text.title,
      description: text.description,
      confirmLabel: t("crud.delete"),
    });
    if (!ok) return;
    try {
      if (props.onDelete) await props.onDelete(row);
      else await pve(hostId, "DELETE", itemPath!(row));
      void load();
    } catch (err) {
      toast.error(toCallError(err).message);
    }
  };

  return (
    <section className="flex flex-col gap-1">
      <GroupHeading
        title={t(props.titleKey)}
        count={list?.length}
        action={
          readOnly ? null : (
            <div className="flex gap-1">
              {props.toolbar?.(() => void load())}
              {fields.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() =>
                    setDialog({ values: valuesFrom(fields, null) })
                  }
                >
                  <Plus className="mr-1 size-3" />
                  {t(props.createLabelKey ?? "crud.add")}
                </Button>
              )}
            </div>
          )
        }
      />
      {props.hintKey && (
        <p className="text-[11px] text-muted-foreground">{t(props.hintKey)}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {!list && !error && (
        <p className="text-xs text-muted-foreground">{t("app.loading")}</p>
      )}
      {list?.length === 0 && (
        <p className="text-xs text-muted-foreground">{t(props.emptyKey)}</p>
      )}
      {list?.map((row) => {
        const view = props.view(row);
        const editable =
          !readOnly &&
          fields.length > 0 &&
          !!itemPath &&
          (props.canEdit?.(row) ?? true);
        const deletable =
          !readOnly &&
          (!!itemPath || !!props.onDelete) &&
          (props.canDelete?.(row) ?? true);
        const extra = readOnly ? null : props.menu?.(row, () => void load());
        return (
          <div
            key={props.rowId(row)}
            className="flex items-center gap-2 border-b border-border/60 py-1.5 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{view.title}</span>
                {view.badges}
              </div>
              {view.detail && (
                <div className="truncate text-[11px] text-muted-foreground">
                  {view.detail}
                </div>
              )}
            </div>
            {(editable || deletable || extra) && (
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
                  {editable && (
                    <DropdownMenuItem onClick={() => void openEdit(row)}>
                      {t("app.edit")}
                    </DropdownMenuItem>
                  )}
                  {extra}
                  {deletable && (
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => void remove(row)}
                    >
                      {t("crud.delete")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        );
      })}
      {dialog && (
        <RecordDialog
          title={
            props.dialogTitle?.(!dialog.row, dialog.row) ??
            t(dialog.row ? "crud.editTitle" : "crud.createTitle", {
              name: dialog.row ? props.rowId(dialog.row) : t(props.titleKey),
            })
          }
          fields={fields}
          initial={dialog.values}
          creating={!dialog.row}
          onClose={() => setDialog(null)}
          onSubmit={async (values) => {
            const creating = !dialog.row;
            const params =
              props.toParams?.(values, creating, dialog.row) ??
              paramsFrom(fields, values, creating);
            if (creating) {
              const answer = await pve(
                hostId,
                props.createMethod ?? "POST",
                props.createPathFor?.(values) ?? props.createPath ?? listPath,
                params,
              );
              props.afterCreate?.(answer, values);
            } else {
              await pve(hostId, "PUT", itemPath!(dialog.row!), params);
            }
            void load();
          }}
        />
      )}
    </section>
  );
}

/** A wide dialog around a list, such as a security group's rules. */
export function PanelDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* sm: so it replaces the dialog's own sm:max-w-lg. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
