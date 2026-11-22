import type { StatusInfo } from "./api";

export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || !isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours} h ${minutes.toString().padStart(2, "0")} min`;
  if (minutes > 0) return `${minutes} min ${secs.toString().padStart(2, "0")} s`;
  return `${secs} s`;
}

/** 29990 -> "30.0k": the compact row has ~200px for four numbers. */
export function formatCompactCount(value?: number | null): string {
  if (value === undefined || value === null || !isFinite(value)) return "-";
  if (Math.abs(value) < 1000) return String(value);
  if (Math.abs(value) < 1000000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1000000).toFixed(1)}M`;
}

/** 1912000000 -> "1.9G": the narrow row has ~120px for four numbers. */
export function formatCompactBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null || !isFinite(bytes)) return "-";
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

/** "5 min", "16 s", "1 h 02" - the Time column of SCSKiller's own table. */
export function formatShortDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hours > 0) return `${hours} h ${minutes.toString().padStart(2, "0")}`;
  if (minutes > 0) return `${minutes} min`;
  return `${secs} s`;
}

/** "29,990" with the machine's grouping, or "-" when SCSKiller has no number. */
export function formatCount(value?: number | null): string {
  if (value === undefined || value === null || !isFinite(value)) return "-";
  return value.toLocaleString();
}

/** 125 s -> "2 min 05 s": how long a compile has been running. */
export function formatElapsed(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "";
  const total = Math.floor(seconds);
  return formatDuration(total) || `${total} s`;
}

/** Short status for the narrow panel ("Needs rebuilding" -> "Rebuild"). */
export function shortStatusLabel(kind?: string | null): string {
  return (
    {
      ok: "Warmed",
      stale: "Rebuild",
      todo: "Not compiled",
      partial: "Partial",
      recording: "Recording",
      blocked: "Blocked",
    } as Record<string, string>
  )[String(kind ?? "unknown")] ?? "Unknown";
}

export const KIND_COLORS: Record<string, string> = {
  ok: "#5bc236", // green: warmed
  stale: "#ff7a45", // orange: needs rebuilding
  todo: "#ffd93d", // yellow: never compiled
  partial: "#c084fc", // purple: partly compiled (was the same yellow as todo)
  recording: "#48b3ff", // blue: needs a 5 min recording
  blocked: "#e05252", // red: unsupported
  unknown: "#8f98a0",
};

export function statusColor(status?: StatusInfo): string {
  return KIND_COLORS[status?.kind ?? "unknown"] ?? KIND_COLORS.unknown;
}

/** "Warmed - 97% - 1.9 GB": the second line of the row. */
export function statusDetail(input: {
  covered_pct?: number | null;
  cache_bytes?: number | null;
  warmed_at?: string | null;
  estimate_seconds?: number | null;
  error?: string;
}): string {
  if (input.error) return input.error;
  const parts: string[] = [];
  if (input.covered_pct !== undefined && input.covered_pct !== null) parts.push(`${input.covered_pct}% covered`);
  const cache = formatBytes(input.cache_bytes);
  if (cache) parts.push(cache);
  if (input.warmed_at) parts.push(`compiled ${input.warmed_at}`);
  else if (input.estimate_seconds) parts.push(`~${formatDuration(input.estimate_seconds)}`);
  return parts.join(" - ");
}
