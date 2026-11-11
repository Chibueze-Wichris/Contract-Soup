import type { Audit, Finding } from "./types";

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Dismissed findings do not count toward exposure or the severity totals. */
export function summarizeFindings(findings: Finding[]): Audit["summary"] {
  const active = findings.filter((f) => f.status !== "dismissed");
  const bySeverity: Record<string, number> = { high: 0, medium: 0, low: 0 };
  const byType: Record<string, number> = {};
  let exposure = 0;
  for (const f of active) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    const impact = f.estimatedImpactUSD ?? 0;
    exposure += impact;
    byType[f.type] = round2((byType[f.type] ?? 0) + impact);
  }
  return { exposureUSD: round2(exposure), bySeverity, byType };
}
