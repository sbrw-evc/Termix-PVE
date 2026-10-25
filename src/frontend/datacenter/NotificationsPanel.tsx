import { useState } from "react";
import { useToast, useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge, DropdownMenuItem } from "@termix-ssh/plugin-sdk/ui";
import { pve, toCallError, type PveParams } from "../api";
import {
  CrudSection,
  paramsFrom,
  type FieldSpec,
  type FormValues,
} from "./crud";
import type { DatacenterProps } from "./DatacenterView";
import {
  SEVERITIES,
  decodeKeyValues,
  encodeKeyValues,
  matcherParams,
  splitList,
  type NotificationMatcher,
  type NotificationTarget,
} from "./notifications";

const NAME = /^[A-Za-z][A-Za-z0-9\-_.]*$/;
const is =
  (...types: string[]) =>
  (v: FormValues) =>
    types.includes(String(v.type));

const TARGET_FIELDS: FieldSpec[] = [
  {
    key: "type",
    labelKey: "notify.type",
    kind: "select",
    required: true,
    createOnly: true,
    local: true,
    default: "smtp",
    options: [
      { value: "smtp", label: "SMTP" },
      { value: "sendmail", label: "Sendmail" },
      { value: "gotify", label: "Gotify" },
      { value: "webhook", label: "Webhook" },
    ],
  },
  {
    key: "name",
    labelKey: "notify.name",
    required: true,
    createOnly: true,
    pattern: NAME,
    patternKey: "crud.id",
  },
  // Mail: sendmail and SMTP.
  {
    key: "server",
    labelKey: "notify.server",
    showIf: is("smtp", "gotify"),
    required: true,
  },
  {
    key: "mode",
    labelKey: "notify.smtpMode",
    kind: "select",
    showIf: is("smtp"),
    options: [{ value: "tls" }, { value: "starttls" }, { value: "insecure" }],
  },
  { key: "port", labelKey: "notify.port", kind: "number", showIf: is("smtp") },
  { key: "username", labelKey: "notify.username", showIf: is("smtp") },
  {
    key: "password",
    labelKey: "notify.password",
    hintKey: "notify.secretHint",
    kind: "password",
    local: true,
    showIf: is("smtp"),
  },
  {
    key: "mailto",
    labelKey: "notify.mailto",
    hintKey: "notify.listHint",
    local: true,
    showIf: is("smtp", "sendmail"),
  },
  {
    key: "mailto-user",
    labelKey: "notify.mailtoUser",
    hintKey: "notify.listHint",
    local: true,
    showIf: is("smtp", "sendmail"),
    placeholder: "root@pam",
  },
  {
    key: "from-address",
    labelKey: "notify.from",
    showIf: is("smtp", "sendmail"),
  },
  { key: "author", labelKey: "notify.author", showIf: is("smtp", "sendmail") },
  // Gotify.
  {
    key: "token",
    labelKey: "notify.token",
    hintKey: "notify.secretHint",
    kind: "password",
    local: true,
    showIf: is("gotify"),
  },
  // Webhook.
  { key: "url", labelKey: "notify.url", showIf: is("webhook"), required: true },
  {
    key: "method",
    labelKey: "notify.method",
    kind: "select",
    showIf: is("webhook"),
    options: [{ value: "post" }, { value: "put" }, { value: "get" }],
  },
  {
    key: "header",
    labelKey: "notify.headers",
    hintKey: "notify.headersHint",
    kind: "textarea",
    local: true,
    showIf: is("webhook"),
  },
  {
    key: "body",
    labelKey: "notify.body",
    hintKey: "notify.bodyHint",
    kind: "textarea",
    showIf: is("webhook"),
  },
  {
    key: "secret",
    labelKey: "notify.secrets",
    hintKey: "notify.secretsHint",
    kind: "textarea",
    local: true,
    showIf: is("webhook"),
  },
  { key: "comment", labelKey: "notify.comment" },
  { key: "disable", labelKey: "notify.disable", kind: "check" },
];

/** Endpoint params: lists as arrays, secrets only when typed. */
export function targetParams(values: FormValues, creating: boolean): PveParams {
  const params = paramsFrom(TARGET_FIELDS, values, creating);
  const type = String(values.type);
  const cleared = params.delete ? String(params.delete).split(",") : [];
  const list = (key: string, items: string[]) => {
    if (items.length) params[key] = items;
    else if (!creating) cleared.push(key);
  };
  if (type === "smtp" || type === "sendmail") {
    list("mailto", splitList(values.mailto));
    list("mailto-user", splitList(values["mailto-user"]));
  }
  if (type === "webhook") list("header", encodeKeyValues(values.header));
  for (const key of ["password", "token"]) {
    const secret = String(values[key] ?? "").trim();
    if (secret) params[key] = secret;
  }
  // Webhook secrets come back masked; only replace them when typed.
  if (type === "webhook" && String(values.secret ?? "").trim()) {
    params.secret = encodeKeyValues(values.secret);
  }
  if (cleared.length) params.delete = [...new Set(cleared)].join(",");
  else delete params.delete;
  return params;
}

export function NotificationsPanel({ hostId, isVisible }: DatacenterProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [targets, setTargets] = useState<NotificationTarget[]>([]);

  const matcherFields: FieldSpec[] = [
    {
      key: "name",
      labelKey: "notify.name",
      required: true,
      createOnly: true,
      local: true,
      pattern: NAME,
      patternKey: "crud.id",
    },
    {
      key: "target",
      labelKey: "notify.targets",
      hintKey: "notify.targetsHint",
      local: true,
      placeholder: targets.map((x) => x.name).join(", "),
    },
    {
      key: "match-severity",
      labelKey: "notify.severity",
      hintKey: "notify.severityHint",
      local: true,
      placeholder: SEVERITIES.join(", "),
    },
    {
      key: "match-field",
      labelKey: "notify.fields",
      hintKey: "notify.fieldsHint",
      kind: "textarea",
      local: true,
    },
    {
      key: "match-calendar",
      labelKey: "notify.calendar",
      hintKey: "notify.calendarHint",
      local: true,
    },
    {
      key: "mode",
      labelKey: "notify.mode",
      kind: "select",
      local: true,
      default: "all",
      options: [
        { value: "all", labelKey: "notify.modeAll" },
        { value: "any", labelKey: "notify.modeAny" },
      ],
    },
    {
      key: "invert-match",
      labelKey: "notify.invert",
      kind: "check",
      local: true,
    },
    { key: "comment", labelKey: "notify.comment", local: true },
    { key: "disable", labelKey: "notify.disable", kind: "check", local: true },
  ];

  const builtin = (row: { origin?: string }) => row.origin === "builtin";

  return (
    <div className="flex flex-col gap-6">
      <CrudSection<NotificationTarget>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="notify.targetsTitle"
        hintKey="notify.targetsHintTop"
        emptyKey="notify.noTargets"
        listPath={["cluster", "notifications", "targets"]}
        onLoaded={setTargets}
        rowId={(x) => x.name}
        view={(x) => ({
          title: x.name,
          detail: x.comment,
          badges: (
            <>
              <Badge variant="outline">{x.type}</Badge>
              {builtin(x) ? (
                <Badge variant="secondary">{t("notify.builtin")}</Badge>
              ) : null}
              {x.disable ? (
                <Badge variant="secondary">{t("notify.disabled")}</Badge>
              ) : null}
            </>
          ),
        })}
        fields={TARGET_FIELDS}
        prepare={(row) => ({
          ...row,
          header: decodeKeyValues(row.header),
          // Secrets never come back in clear; the field stays empty.
          secret: "",
        })}
        createPathFor={(v) => [
          "cluster",
          "notifications",
          "endpoints",
          String(v.type),
        ]}
        itemPath={(x) => [
          "cluster",
          "notifications",
          "endpoints",
          x.type,
          x.name,
        ]}
        loadItem
        toParams={targetParams}
        createLabelKey="notify.addTarget"
        canDelete={(x) => !builtin(x)}
        menu={(x) => (
          <DropdownMenuItem
            onClick={async () => {
              try {
                await pve(hostId, "POST", [
                  "cluster",
                  "notifications",
                  "targets",
                  x.name,
                  "test",
                ]);
                toast.success(t("notify.testSent", { name: x.name }));
              } catch (err) {
                toast.error(toCallError(err).message);
              }
            }}
          >
            {t("notify.test")}
          </DropdownMenuItem>
        )}
        deleteText={(x) => ({
          title: t("notify.deleteTitle", { name: x.name }),
          description: t("notify.deleteTarget"),
        })}
      />
      <CrudSection<NotificationMatcher>
        hostId={hostId}
        isVisible={isVisible}
        titleKey="notify.matchersTitle"
        hintKey="notify.matchersHint"
        emptyKey="notify.noMatchers"
        listPath={["cluster", "notifications", "matchers"]}
        rowId={(m) => m.name}
        view={(m) => ({
          title: m.name,
          detail: [
            t("notify.sendsTo", {
              targets: splitList([m.target].flat().join(",")).join(", ") || "-",
            }),
            [m["match-severity"]].flat().filter(Boolean).join(", "),
            m.comment,
          ]
            .filter(Boolean)
            .join(" · "),
          badges: (
            <>
              {builtin(m) ? (
                <Badge variant="secondary">{t("notify.builtin")}</Badge>
              ) : null}
              {m.disable ? (
                <Badge variant="secondary">{t("notify.disabled")}</Badge>
              ) : null}
            </>
          ),
        })}
        fields={matcherFields}
        prepare={(row) => ({
          ...row,
          "match-field": [row["match-field"]].flat().filter(Boolean).join("\n"),
        })}
        createPath={["cluster", "notifications", "matchers"]}
        itemPath={(m) => ["cluster", "notifications", "matchers", m.name]}
        loadItem
        toParams={(v, creating) => matcherParams(v, creating)}
        createLabelKey="notify.addMatcher"
        canDelete={(m) => !builtin(m)}
        deleteText={(m) => ({
          title: t("notify.deleteTitle", { name: m.name }),
          description: t("notify.deleteMatcher"),
        })}
      />
    </div>
  );
}
