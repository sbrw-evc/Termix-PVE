import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { Badge } from "@termix-ssh/plugin-sdk/ui";
import type { PveParams } from "../api";
import {
  CrudSection,
  paramsFrom,
  type FieldSpec,
  type FormValues,
} from "./crud";
import type { DatacenterProps } from "./DatacenterView";

interface MetricServer extends Record<string, unknown> {
  id: string;
  type: "graphite" | "influxdb" | "opentelemetry";
  server?: string;
  port?: number;
  disable?: number;
}

const ID = /^[A-Za-z][A-Za-z0-9\-_.]*$/;
const is =
  (...types: string[]) =>
  (v: FormValues) =>
    types.includes(String(v.type));

export const METRIC_FIELDS: FieldSpec[] = [
  {
    key: "id",
    labelKey: "metrics.id",
    required: true,
    createOnly: true,
    local: true,
    pattern: ID,
    patternKey: "crud.id",
  },
  {
    key: "type",
    labelKey: "metrics.type",
    kind: "select",
    required: true,
    createOnly: true,
    default: "influxdb",
    options: [
      { value: "influxdb", label: "InfluxDB" },
      { value: "graphite", label: "Graphite" },
      { value: "opentelemetry", label: "OpenTelemetry" },
    ],
  },
  {
    key: "server",
    labelKey: "metrics.server",
    required: true,
    placeholder: "10.0.0.5",
  },
  {
    key: "port",
    labelKey: "metrics.port",
    kind: "number",
    required: true,
    placeholder: "8089",
  },
  {
    key: "influxdbproto",
    labelKey: "metrics.protocol",
    kind: "select",
    showIf: is("influxdb"),
    options: [{ value: "udp" }, { value: "http" }, { value: "https" }],
  },
  {
    key: "organization",
    labelKey: "metrics.organization",
    showIf: (v) => is("influxdb")(v) && v.influxdbproto !== "udp",
  },
  {
    key: "bucket",
    labelKey: "metrics.bucket",
    showIf: (v) => is("influxdb")(v) && v.influxdbproto !== "udp",
  },
  {
    key: "token",
    labelKey: "metrics.token",
    hintKey: "metrics.tokenHint",
    kind: "password",
    local: true,
    showIf: (v) => is("influxdb")(v) && v.influxdbproto !== "udp",
  },
  {
    key: "api-path-prefix",
    labelKey: "metrics.pathPrefix",
    showIf: (v) => is("influxdb")(v) && v.influxdbproto !== "udp",
  },
  {
    key: "verify-certificate",
    labelKey: "metrics.verify",
    kind: "check",
    default: true,
    showIf: (v) => is("influxdb")(v) && v.influxdbproto === "https",
  },
  {
    key: "proto",
    labelKey: "metrics.protocol",
    kind: "select",
    showIf: is("graphite"),
    options: [{ value: "udp" }, { value: "tcp" }],
  },
  {
    key: "path",
    labelKey: "metrics.graphitePath",
    showIf: is("graphite"),
    placeholder: "proxmox",
  },
  {
    key: "otel-protocol",
    labelKey: "metrics.protocol",
    kind: "select",
    showIf: is("opentelemetry"),
    options: [{ value: "https" }, { value: "http" }],
  },
  {
    key: "otel-path",
    labelKey: "metrics.otelPath",
    showIf: is("opentelemetry"),
    placeholder: "/v1/metrics",
  },
  {
    key: "otel-compression",
    labelKey: "metrics.compression",
    kind: "select",
    showIf: is("opentelemetry"),
    options: [{ value: "gzip" }, { value: "none" }],
  },
  {
    key: "otel-verify-ssl",
    labelKey: "metrics.verify",
    kind: "check",
    default: true,
    showIf: is("opentelemetry"),
  },
  {
    key: "mtu",
    labelKey: "metrics.mtu",
    kind: "number",
    showIf: (v) =>
      (is("influxdb")(v) &&
        v.influxdbproto !== "http" &&
        v.influxdbproto !== "https") ||
      (is("graphite")(v) && v.proto !== "tcp"),
    placeholder: "1500",
  },
  {
    key: "timeout",
    labelKey: "metrics.timeout",
    kind: "number",
    placeholder: "1",
  },
  { key: "disable", labelKey: "metrics.disable", kind: "check" },
];

/** Params for a metric server: the token only when one was typed. */
export function metricParams(values: FormValues, creating: boolean): PveParams {
  const params = paramsFrom(METRIC_FIELDS, values, creating);
  const token = String(values.token ?? "").trim();
  if (token) params.token = token;
  return params;
}

export function MetricsPanel({ hostId, isVisible }: DatacenterProps) {
  const { t } = useTranslation();
  return (
    <CrudSection<MetricServer>
      hostId={hostId}
      isVisible={isVisible}
      titleKey="metrics.title"
      hintKey="metrics.hint"
      emptyKey="metrics.none"
      listPath={["cluster", "metrics", "server"]}
      rowId={(m) => m.id}
      view={(m) => ({
        title: m.id,
        detail: [m.server, m.port].filter(Boolean).join(":"),
        badges: (
          <>
            <Badge variant="outline">{m.type}</Badge>
            {m.disable ? (
              <Badge variant="secondary">{t("metrics.disabled")}</Badge>
            ) : null}
          </>
        ),
      })}
      fields={METRIC_FIELDS}
      createPathFor={(values) => [
        "cluster",
        "metrics",
        "server",
        String(values.id),
      ]}
      itemPath={(m) => ["cluster", "metrics", "server", m.id]}
      loadItem
      toParams={(values, creating) => metricParams(values, creating)}
      createLabelKey="metrics.add"
      deleteText={(m) => ({
        title: t("metrics.deleteTitle", { id: m.id }),
        description: t("metrics.deleteDescription"),
      })}
    />
  );
}
