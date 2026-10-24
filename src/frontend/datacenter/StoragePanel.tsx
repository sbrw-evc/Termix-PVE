import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge } from "@termix-ssh/plugin-sdk/ui";
import { CrudSection, paramsFrom, type FieldSpec } from "./crud";
import type { DatacenterProps } from "./DatacenterView";

interface StorageEntry extends Record<string, unknown> {
  storage: string;
  type: string;
  content?: string;
  nodes?: string;
  shared?: number;
  disable?: number;
  server?: string;
  datastore?: string;
}

const ID_RE = /^[A-Za-z][A-Za-z0-9_.-]{1,99}$/;
/** SHA-256 fingerprint, as PBS shows it: 32 hex pairs with colons. */
const FINGERPRINT_RE = /^([0-9a-f]{2}:){31}[0-9a-f]{2}$/i;

/** A Proxmox Backup Server storage. The password is only sent when typed. */
export const PBS_FIELDS: FieldSpec[] = [
  {
    key: "storage",
    labelKey: "storage.pbs.id",
    required: true,
    createOnly: true,
    pattern: ID_RE,
    patternKey: "storage.pbs.idFormat",
  },
  {
    key: "server",
    labelKey: "storage.pbs.server",
    required: true,
    createOnly: true,
    placeholder: "pbs.example.com",
  },
  {
    key: "datastore",
    labelKey: "storage.pbs.datastore",
    required: true,
    createOnly: true,
  },
  {
    key: "namespace",
    labelKey: "storage.pbs.namespace",
    hintKey: "storage.pbs.namespaceHint",
  },
  {
    key: "username",
    labelKey: "storage.pbs.username",
    required: true,
    placeholder: "backup@pbs",
  },
  {
    key: "password",
    labelKey: "storage.pbs.password",
    kind: "password",
    hintKey: "storage.pbs.passwordHint",
    local: true,
  },
  {
    key: "fingerprint",
    labelKey: "storage.pbs.fingerprint",
    hintKey: "storage.pbs.fingerprintHint",
    pattern: FINGERPRINT_RE,
    patternKey: "storage.pbs.fingerprintFormat",
  },
  {
    key: "port",
    labelKey: "storage.pbs.port",
    kind: "number",
    placeholder: "8007",
  },
  { key: "disable", labelKey: "storage.pbs.disable", kind: "check" },
];

export function StoragePanel({ hostId, isVisible }: DatacenterProps) {
  const { t } = useTranslation();
  return (
    <CrudSection<StorageEntry>
      hostId={hostId}
      isVisible={isVisible}
      titleKey="storage.entries.title"
      hintKey="storage.entries.hint"
      emptyKey="storage.entries.none"
      listPath={["storage"]}
      rows={(data) =>
        [...(data as StorageEntry[])].sort((a, b) =>
          a.storage.localeCompare(b.storage),
        )
      }
      rowId={(row) => row.storage}
      view={(row) => ({
        title: row.storage,
        badges: (
          <>
            <Badge variant="outline">{row.type}</Badge>
            {row.disable ? (
              <Badge variant="secondary">{t("storage.entries.disabled")}</Badge>
            ) : null}
            {row.shared ? (
              <Badge variant="secondary">{t("storage.entries.shared")}</Badge>
            ) : null}
          </>
        ),
        detail: [
          row.server && row.datastore
            ? `${row.server} · ${row.datastore}`
            : null,
          row.content?.split(",").join(", "),
          row.nodes ? t("storage.entries.onNodes", { nodes: row.nodes }) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      })}
      fields={PBS_FIELDS}
      createLabelKey="storage.pbs.add"
      dialogTitle={(creating, row) =>
        creating
          ? t("storage.pbs.addTitle")
          : t("storage.pbs.editTitle", { name: row?.storage })
      }
      itemPath={(row) => ["storage", row.storage]}
      // Only Proxmox Backup Server entries are edited here; the rest in Proxmox.
      canEdit={(row) => row.type === "pbs"}
      deleteText={(row) => ({
        title: t("storage.entries.removeTitle", { name: row.storage }),
        description: t("storage.entries.removeDescription"),
      })}
      toParams={(values, creating) => {
        const params = paramsFrom(PBS_FIELDS, values, creating);
        const password = String(values.password ?? "");
        if (password) params.password = password;
        if (creating) {
          params.type = "pbs";
          params.content = "backup";
        }
        return params;
      }}
    />
  );
}
