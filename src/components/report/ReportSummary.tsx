import { Suspense, lazy, useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { Audit } from "@/analyzer";
import { findingTypeLabel } from "@/analyzer/categories";
import { Card, CardHeader, ProgressBar, SeverityBadge, Skeleton } from "@/components/ui";
import { FINDING_STATUSES, SEVERITIES, countByStatus, isAiFinding } from "@/lib/findings";
import { formatCount, formatUsd, plural } from "@/lib/format";
import type { ExposureDatum } from "./ExposureChart";

// Recharts is large, so it loads on its own once the report is showing.
const ExposureChart = lazy(() => import("./ExposureChart"));

/** True from the given viewport width up. The chart is only drawn where it has room. */
function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const subscribe = useCallback(
    (notify: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="text-sm text-muted">{label}</h2>
      {children}
    </Card>
  );
}

/** The report's headline figures. Dismissed findings are left out of every total here. */
export function ReportSummary({ audit }: { audit: Audit }) {
  const { findings, summary } = audit;
  const byStatus = countByStatus(findings);
  const counted = findings.length - byStatus.dismissed;
  const reviewed = findings.length - byStatus.open;
  // What Gemini noticed in the wording is listed, but it has no amount and is never part of the exposure.
  const observations = findings.filter((f) => f.status !== "dismissed" && isAiFinding(f)).length;
  const fromChecks = counted - observations;
  const roomForChart = useMinWidth(640);

  const rows = useMemo(() => {
    const perType = new Map<string, { count: number; priced: boolean; ai: boolean }>();
    for (const f of findings) {
      if (f.status === "dismissed") continue;
      const row = perType.get(f.type) ?? { count: 0, priced: false, ai: isAiFinding(f) };
      row.count += 1;
      if (f.estimatedImpactUSD !== null) row.priced = true;
      perType.set(f.type, row);
    }
    return [...perType]
      .map(([type, row]) => ({ type, label: findingTypeLabel(type), ...row, amount: summary.byType[type] ?? 0 }))
      .sort((a, b) => Number(a.ai) - Number(b.ai) || b.amount - a.amount || a.label.localeCompare(b.label));
  }, [findings, summary]);
  const bars: ExposureDatum[] = rows.filter((r) => r.amount > 0);

  return (
    <section aria-label="Summary" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Estimated exposure">
          <p className="num mt-2 text-2xl font-semibold text-ink">{formatUsd(summary.exposureUSD)}</p>
          <p className="mt-1 text-xs text-muted">
            {counted === 0
              ? "No findings are counted."
              : observations === 0
                ? `Across ${plural(counted, "finding")}.`
                : `From ${plural(fromChecks, "finding")} of the money checks.`}
            {byStatus.dismissed > 0 ? ` ${formatCount(byStatus.dismissed)} dismissed, not counted.` : ""}
          </p>
          {observations > 0 ? (
            <p className="mt-1 text-xs text-muted">
              {plural(observations, "observation")} from Gemini&rsquo;s reading {observations === 1 ? "has" : "have"} no estimate
              and {observations === 1 ? "adds" : "add"} nothing here.
            </p>
          ) : null}
        </Stat>

        <Stat label="Findings by severity">
          <ul className="mt-3 space-y-2">
            {SEVERITIES.map((s) => (
              <li key={s.value} className="flex items-center justify-between gap-3">
                <SeverityBadge severity={s.value} />
                <span className="num text-sm font-semibold text-ink">{formatCount(summary.bySeverity[s.value] ?? 0)}</span>
              </li>
            ))}
          </ul>
          {byStatus.dismissed > 0 ? <p className="mt-2 text-xs text-muted">Dismissed findings are not counted.</p> : null}
          {observations > 0 ? (
            <p className="mt-2 text-xs text-muted">
              Includes {plural(observations, "observation")} from Gemini&rsquo;s reading, with the severity Gemini gave{" "}
              {observations === 1 ? "it" : "them"}.
            </p>
          ) : null}
        </Stat>

        <Stat label="Review progress">
          <p className="num mt-2 text-2xl font-semibold text-ink">
            {formatCount(reviewed)} <span className="text-base font-medium text-muted">of {formatCount(findings.length)} reviewed</span>
          </p>
          <ProgressBar
            className="mt-3"
            label="Findings reviewed"
            value={findings.length === 0 ? 0 : reviewed / findings.length}
            valueText={`${reviewed} of ${findings.length} reviewed`}
          />
          <p className="num mt-2 text-xs text-muted">
            {FINDING_STATUSES.map((s) => `${s.label} ${formatCount(byStatus[s.value])}`).join(" · ")}
          </p>
        </Stat>
      </div>

      {rows.length > 0 ? (
        <Card>
          <CardHeader title="Estimated exposure by type" description="Dismissed findings are left out." />
          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-center">
            {roomForChart && bars.length > 0 ? (
              <div aria-hidden="true">
                <Suspense fallback={<Skeleton className="h-40 w-full rounded-lg" />}>
                  <ExposureChart data={bars} />
                </Suspense>
              </div>
            ) : null}
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Estimated exposure and number of findings for each type</caption>
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Type
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Findings
                  </th>
                  <th scope="col" className="py-2 pl-3 text-right font-medium">
                    Estimate
                  </th>
                </tr>
              </thead>
              <tbody className="num">
                {rows.map((r) => (
                  <tr key={r.type} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-2 pr-3 font-normal text-ink">
                      {r.label}
                      {r.ai ? <span className="block text-xs text-muted">AI reading</span> : null}
                    </th>
                    <td className="px-3 py-2 text-right text-muted">{formatCount(r.count)}</td>
                    {r.priced ? (
                      <td className="py-2 pl-3 text-right font-medium text-ink">{formatUsd(r.amount)}</td>
                    ) : (
                      <td className="py-2 pl-3 text-right text-muted">No estimate</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </section>
  );
}
