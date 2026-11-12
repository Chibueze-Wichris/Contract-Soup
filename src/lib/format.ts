const COUNT = new Intl.NumberFormat("en-US");

/** 1234567 -> "1,234,567" */
export function formatCount(n: number): string {
  return COUNT.format(n);
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** 1234.5 -> "$1,234.50" */
export function formatUsd(n: number): string {
  return USD.format(n);
}

const DAY = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/** "2025-03-04" -> "Mar 4, 2025". The month is spelled out so day and month cannot be confused. */
export function formatIsoDate(iso: string): string {
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(time) ? iso : DAY.format(time);
}

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "2026-11-11T15:22:05.000Z" -> "Nov 11, 2026, 3:22 PM", in the reader's own time zone. */
export function formatDateTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : DATE_TIME.format(time);
}

/** 1536 -> "1.5 KB". Counted in 1024s, the same way the upload limits are. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/** plural(1, "row") -> "1 row", plural(1200, "row") -> "1,200 rows" */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}
