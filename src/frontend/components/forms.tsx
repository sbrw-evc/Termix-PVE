import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select2,
} from "@termix-ssh/plugin-sdk/ui";
import { toCallError, type PveCallError } from "../api";

/**
 * A dialog that submits once, shows Proxmox's own reason when it refuses,
 * and closes on success.
 */
export function FormDialog({
  title,
  submitLabel,
  destructive,
  canSubmit = true,
  onSubmit,
  onClose,
  wide,
  hideCancel,
  children,
}: {
  title: string;
  submitLabel: string;
  destructive?: boolean;
  canSubmit?: boolean;
  /** Resolves when done; a throw keeps the dialog open with the error. */
  onSubmit: () => Promise<void>;
  onClose: () => void;
  wide?: boolean;
  /** For a dialog with one way out, like a list you only browse. */
  hideCancel?: boolean;
  children: (fieldError: (key: string) => string | undefined) => ReactNode;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PveCallError | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      onClose();
    } catch (err) {
      setError(toCallError(err));
    } finally {
      setBusy(false);
    }
  };

  // Field errors no input asked for still need saying, or Proxmox's
  // "Parameter verification failed." arrives with nothing to act on.
  const claimed = new Set<string>();
  const body = children((key) => {
    claimed.add(key);
    return error?.fieldErrors?.[key];
  });
  const unclaimed = Object.entries(error?.fieldErrors ?? {}).filter(
    ([key]) => !claimed.has(key),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className={wide ? "sm:max-w-2xl" : "sm:max-w-md"}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
            {body}
          </div>
          {error && (
            <p
              role="alert"
              className="text-xs text-destructive whitespace-pre-wrap"
            >
              {error.message}
              {unclaimed.map(
                ([key, message]) => `
${key}: ${message}`,
              )}
            </p>
          )}
          <DialogFooter>
            {!hideCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={busy}
              >
                {t("app.cancel")}
              </Button>
            )}
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={busy || !canSubmit}
            >
              {busy ? t("app.working") : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    // In a grid, a field spans two of its rows, the label's and the input's,
    // and shares them with the fields beside it (subgrid): a label that wraps
    // or a hint under one input still leaves the inputs of a row level.
    <div
      data-pve-field=""
      className="grid gap-1 [.grid>&]:row-span-2 [.grid>&]:grid-rows-subgrid"
    >
      <Label className="self-end text-xs">{label}</Label>
      <div className="flex flex-col gap-1">
        {children}
        {error ? (
          <span className="text-[11px] text-destructive">{error}</span>
        ) : hint ? (
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        ) : null}
      </div>
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  min,
  max,
  disabled,
}: {
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number" | "password";
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <Input
      className="h-8 text-xs"
      type={type}
      min={min}
      max={max}
      disabled={disabled}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function SelectInput({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <Select2
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select2>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    // Beside fields in a grid, it takes their two rows too and sits level
    // with their inputs, or the grid would place the next field a row off.
    <label className="flex items-start gap-2 text-xs [.grid:has(>[data-pve-field])>&]:row-span-2 [.grid:has(>[data-pve-field])>&]:min-h-8 [.grid:has(>[data-pve-field])>&]:items-center [.grid:has(>[data-pve-field])>&]:self-end">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <span className="flex flex-col">
        {label}
        {hint && (
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        )}
      </span>
    </label>
  );
}
