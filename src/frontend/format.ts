export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes)) {
    return "-";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Bytes per second, as network and disk charts show them. */
export function formatRate(bytes: number): string {
  return `${formatBytes(bytes)}/s`;
}

export function percent(
  used: number | undefined,
  total: number | undefined,
): number | null {
  if (!used || !total) return used === 0 && total ? 0 : null;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/** Uptime as two units in the UI language: "1d 1h" in English, "1 д 1 ч" in Russian. */
export function formatUptime(
  seconds: number | undefined,
  language = "en",
): string {
  if (!seconds) return "-";
  const unit = (value: number, name: "day" | "hour" | "minute") => {
    try {
      return new Intl.NumberFormat(language, {
        style: "unit",
        unit: name,
        unitDisplay: "narrow",
      }).format(value);
    } catch {
      return `${value}${name[0]}`;
    }
  };
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${unit(days, "day")} ${unit(hours, "hour")}`;
  if (hours) return `${unit(hours, "hour")} ${unit(minutes, "minute")}`;
  return unit(minutes, "minute");
}

/** Megabytes and gibibytes as the create forms take them. */
export const GIB = 1024 ** 3;
