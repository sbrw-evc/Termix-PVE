import { useEffect, useState } from "react";
import { useTranslation } from "@termix-ssh/plugin-sdk/frontend";
import { GroupHeading, LineChart, Segmented } from "@termix-ssh/plugin-sdk/ui";
import { pve, toCallError, type GuestType } from "../api";
import { formatBytes, formatRate } from "../format";

export type Timeframe = "hour" | "day" | "week" | "month" | "year";
const TIMEFRAMES: Timeframe[] = ["hour", "day", "week", "month", "year"];

/** One sample of /rrddata. Nodes and guests name some fields differently. */
export type RrdPoint = Record<string, number | undefined> & { time: number };

export interface ChartSpec {
  key: string;
  titleKey: string;
  series: Array<{ field: string; labelKey: string; color: string }>;
  /** Percent of a field, against its maximum field. */
  ratioOf?: string;
  format: "percent" | "bytes" | "rate" | "plain";
}

const C1 = "var(--chart-1)";
const C2 = "var(--chart-2)";

export const NODE_CHARTS: ChartSpec[] = [
  {
    key: "cpu",
    titleKey: "charts.cpu",
    series: [
      { field: "cpu", labelKey: "charts.cpuUsage", color: C1 },
      { field: "iowait", labelKey: "charts.ioDelay", color: C2 },
    ],
    format: "percent",
  },
  {
    key: "load",
    titleKey: "charts.load",
    series: [{ field: "loadavg", labelKey: "charts.load", color: C1 }],
    format: "plain",
  },
  {
    key: "memory",
    titleKey: "charts.memory",
    series: [
      { field: "memused", labelKey: "charts.used", color: C1 },
      { field: "memtotal", labelKey: "charts.total", color: C2 },
    ],
    format: "bytes",
  },
  {
    key: "network",
    titleKey: "charts.network",
    series: [
      { field: "netin", labelKey: "charts.in", color: C1 },
      { field: "netout", labelKey: "charts.out", color: C2 },
    ],
    format: "rate",
  },
];

export const GUEST_CHARTS: ChartSpec[] = [
  {
    key: "cpu",
    titleKey: "charts.cpu",
    series: [{ field: "cpu", labelKey: "charts.cpuUsage", color: C1 }],
    format: "percent",
  },
  {
    key: "memory",
    titleKey: "charts.memory",
    series: [
      { field: "mem", labelKey: "charts.used", color: C1 },
      { field: "maxmem", labelKey: "charts.total", color: C2 },
    ],
    format: "bytes",
  },
  {
    key: "network",
    titleKey: "charts.network",
    series: [
      { field: "netin", labelKey: "charts.in", color: C1 },
      { field: "netout", labelKey: "charts.out", color: C2 },
    ],
    format: "rate",
  },
  {
    key: "disk",
    titleKey: "charts.diskIo",
    series: [
      { field: "diskread", labelKey: "charts.read", color: C1 },
      { field: "diskwrite", labelKey: "charts.write", color: C2 },
    ],
    format: "rate",
  },
];

/** Values a chart plots: CPU comes from PVE as a 0..1 share. */
export function seriesValues(
  points: RrdPoint[],
  field: string,
  format: ChartSpec["format"],
): Array<number | null> {
  return points.map((point) => {
    const value = point[field];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return format === "percent" ? value * 100 : value;
  });
}

export function chartDomain(
  values: Array<number | null>,
  format: ChartSpec["format"],
): [number, number] {
  if (format === "percent") return [0, 100];
  const max = Math.max(0, ...values.filter((v): v is number => v !== null));
  if (max > 0) return [0, max * 1.1];
  // All zero: a byte axis up to 1 would label every tick "1 B".
  return [0, format === "bytes" || format === "rate" ? 1024 : 1];
}

/** Whether a chart has anything to draw. */
export function hasData(values: Array<number | null>): boolean {
  return values.some((v) => v !== null);
}

function formatter(format: ChartSpec["format"]): (v: number) => string {
  if (format === "percent") return (v) => `${v.toFixed(0)}%`;
  if (format === "bytes") return (v) => formatBytes(v);
  if (format === "rate") return (v) => formatRate(v);
  return (v) => v.toFixed(2);
}

export function RrdCharts({
  hostId,
  node,
  guest,
  isVisible,
}: {
  hostId: number;
  node: string;
  guest?: { type: GuestType; vmid: number };
  isVisible: boolean;
}) {
  const { t } = useTranslation();
  const [timeframe, setTimeframe] = useState<Timeframe>("hour");
  const [points, setPoints] = useState<RrdPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const specs = guest ? GUEST_CHARTS : NODE_CHARTS;
  const guestKey = guest ? `${guest.type}/${guest.vmid}` : "";

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    const path = guest
      ? ["nodes", node, guest.type, guest.vmid, "rrddata"]
      : ["nodes", node, "rrddata"];
    const load = () =>
      pve<RrdPoint[]>(hostId, "GET", path, { timeframe, cf: "AVERAGE" }).then(
        (data) => {
          if (cancelled) return;
          setPoints((data ?? []).filter((p) => typeof p.time === "number"));
          setError(null);
        },
        (err) => {
          if (!cancelled) setError(toCallError(err).message);
        },
      );
    void load();
    // PVE writes a new sample once a minute.
    const timer = setInterval(() => void load(), 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // guestKey stands in for the guest object, which is new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, node, guestKey, timeframe, isVisible]);

  const timestamps = (points ?? []).map((p) =>
    new Date(p.time * 1000).toISOString(),
  );

  return (
    <div className="flex flex-col gap-3">
      <GroupHeading
        title={t("charts.title")}
        action={
          <Segmented
            value={timeframe}
            onChange={(value) => setTimeframe(value as Timeframe)}
            options={TIMEFRAMES.map((value) => ({
              value,
              label: t(`charts.timeframe.${value}`),
            }))}
          />
        }
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!points && !error && (
        <p className="text-xs text-muted-foreground">{t("app.loading")}</p>
      )}
      {points && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-3">
          {specs.map((spec) => {
            const series = spec.series.map((s) => ({
              key: s.field,
              label: t(s.labelKey),
              color: s.color,
              data: seriesValues(points, s.field, spec.format),
            }));
            const all = series.flatMap((s) => s.data);
            return (
              <div key={spec.key} className="border border-border p-2.5">
                <div className="mb-1 text-xs text-muted-foreground">
                  {t(spec.titleKey)}
                </div>
                {hasData(all) ? (
                  <LineChart
                    series={series}
                    timestamps={timestamps}
                    domain={chartDomain(all, spec.format)}
                    yFormatter={formatter(spec.format)}
                    height={140}
                  />
                ) : (
                  <div className="flex h-[140px] items-center justify-center text-xs text-muted-foreground">
                    {t("charts.noData")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
