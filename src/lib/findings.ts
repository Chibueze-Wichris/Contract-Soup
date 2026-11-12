import type { Finding } from "@/analyzer";
import { formatUsd } from "@/lib/format";

/** Display helpers for findings: labels, ordering and filtering. No analysis happens here. */

export type Severity = Finding["severity"];
export type FindingStatus = Finding["status"];

export const SEVERITIES: readonly { value: Severity; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

export const FINDING_STATUSES: readonly { value: FindingStatus; label: string; help: string }[] = [
  { value: "open", label: "Open", help: "Not reviewed yet." },
  { value: "confirmed", label: "Confirmed", help: "A real problem to raise with the vendor." },
  { value: "legal_review", label: "Legal review", help: "Passed to your legal team to decide." },
  { value: "dismissed", label: "Dismissed", help: "Not a problem. Left out of the totals." },
];

export function severityLabel(severity: Severity): string {
  return SEVERITIES.find((s) => s.value === severity)?.label ?? severity;
}

export function statusLabel(status: FindingStatus): string {
  return FINDING_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/** "$15,700.00", or "No estimate" when the finding has no dollar figure. */
export function impactText(finding: Pick<Finding, "estimatedImpactUSD">): string {
  return finding.estimatedImpactUSD === null ? "No estimate" : formatUsd(finding.estimatedImpactUSD);
}

/** Where a piece of evidence comes from. The analyzer uses page 0 for evidence taken from the claims file. */
export function evidenceSource(page: number): string {
  return page > 0 ? `Contract, page ${page}` : "Claims file";
}

export type FindingSort = "severity" | "impact";

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** A sorted copy. "severity" puts High first and breaks ties by the larger estimate; "impact" goes by the estimate alone. */
export function sortFindings(findings: readonly Finding[], sort: FindingSort): Finding[] {
  const impact = (f: Finding): number => f.estimatedImpactUSD ?? -1;
  return [...findings].sort((a, b) => {
    if (sort === "severity" && a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return impact(b) - impact(a) || a.title.localeCompare(b.title);
  });
}

export interface FindingFilter {
  status: FindingStatus | "all";
  severity: Severity | "all";
}

export const NO_FILTER: FindingFilter = { status: "all", severity: "all" };

export function filterFindings(findings: readonly Finding[], filter: FindingFilter): Finding[] {
  return findings.filter(
    (f) => (filter.status === "all" || f.status === filter.status) && (filter.severity === "all" || f.severity === filter.severity),
  );
}

export function countByStatus(findings: readonly Finding[]): Record<FindingStatus, number> {
  const counts: Record<FindingStatus, number> = { open: 0, confirmed: 0, legal_review: 0, dismissed: 0 };
  for (const f of findings) counts[f.status] += 1;
  return counts;
}

/** Counts every finding, dismissed ones included. The report totals in `Audit.summary` leave dismissed ones out. */
export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}
