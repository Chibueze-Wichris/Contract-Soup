import type { AuditListItem } from "@/lib/auditRecord";

/** Searching, sorting and adding up the list of saved reports. Pure functions. */

export type ReportSort = "newest" | "oldest" | "exposure" | "name";

export const REPORT_SORTS: readonly { value: ReportSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "exposure", label: "Largest exposure first" },
  { value: "name", label: "Name, A to Z" },
];

/** Reports whose name or contract file holds every word of the search, in any order and any case. */
export function searchReports(items: readonly AuditListItem[], query: string): AuditListItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const text = `${item.name}\n${item.contractFileName}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** A sorted copy. Ties fall back to newest first, then to the name. */
export function sortReports(items: readonly AuditListItem[], sort: ReportSort): AuditListItem[] {
  const byDate = (a: AuditListItem, b: AuditListItem): number => b.createdAt.localeCompare(a.createdAt);
  const byName = (a: AuditListItem, b: AuditListItem): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  return [...items].sort((a, b) => {
    if (sort === "oldest") return byDate(b, a) || byName(a, b);
    if (sort === "exposure") return b.exposureUSD - a.exposureUSD || byDate(a, b) || byName(a, b);
    if (sort === "name") return byName(a, b) || byDate(a, b);
    return byDate(a, b) || byName(a, b);
  });
}

export interface ReportTotals {
  audits: number;
  /** Estimated exposure across every listed report, leaving dismissed findings out. */
  exposureUSD: number;
  /** Findings nobody has reviewed yet. */
  openFindings: number;
}

export function totalReports(items: readonly AuditListItem[]): ReportTotals {
  let cents = 0;
  let openFindings = 0;
  for (const item of items) {
    cents += Math.round(item.exposureUSD * 100); // whole cents, so many small amounts add up exactly
    openFindings += item.openCount;
  }
  return { audits: items.length, exposureUSD: cents / 100, openFindings };
}
