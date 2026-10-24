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

export function formatUptime(seconds: number | undefined): string {
  if (!seconds) return "-";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Megabytes and gibibytes as the create forms take them. */
export const GIB = 1024 ** 3;
