import { useEffect } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Field, SelectInput } from "./forms";
import { listBridges, listStorages, useLoad } from "../guests/lookups";

/** Storages on a node that hold one kind of content: images, rootdir, iso... */
export function StoragePicker({
  hostId,
  node,
  content,
  value,
  onChange,
  error,
  label,
  emptyLabel,
}: {
  hostId: number;
  node: string;
  content: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  label?: string;
  /** Offers an empty choice with this label. */
  emptyLabel?: string;
}) {
  const { t } = useTranslation();
  const storages = useLoad(
    () => listStorages(hostId, node, content),
    [hostId, node, content],
  );
  return (
    <Field label={label ?? t("guests.fields.storage")} error={error}>
      <SelectInput
        value={value}
        onChange={onChange}
        placeholder={emptyLabel ?? t("guests.fields.pick")}
        options={(storages.data ?? []).map((s) => ({
          value: s.storage,
          label: s.storage,
        }))}
      />
    </Field>
  );
}

/** Bridges on a node. Fills in the first one when nothing is chosen yet. */
export function BridgePicker({
  hostId,
  node,
  value,
  onChange,
  error,
}: {
  hostId: number;
  node: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const bridges = useLoad(() => listBridges(hostId, node), [hostId, node]);
  useEffect(() => {
    if (!value && bridges.data?.[0]) onChange(bridges.data[0]);
    // Only when the list arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridges.data]);
  const options = bridges.data ?? [];
  return (
    <Field label={t("guests.fields.bridge")} error={error}>
      <SelectInput
        value={value}
        onChange={onChange}
        options={(options.includes(value) || !value
          ? options
          : [value, ...options]
        ).map((b) => ({
          value: b,
          label: b,
        }))}
      />
    </Field>
  );
}
