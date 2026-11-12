import { useId, useMemo, useState } from "react";
import { SearchX } from "lucide-react";
import type { Audit } from "@/analyzer";
import { Button, Card, Select } from "@/components/ui";
import {
  FINDING_STATUSES,
  NO_FILTER,
  SEVERITIES,
  countBySeverity,
  countByStatus,
  filterFindings,
  sortFindings,
  type FindingFilter,
  type FindingSort,
} from "@/lib/findings";
import { formatCount, plural } from "@/lib/format";
import type { FindingPatch } from "@/lib/useAudit";
import { FindingDrawer, type OpenFinding } from "./FindingDrawer";
import { FindingRow } from "./FindingRow";

interface FindingsSectionProps {
  audit: Audit;
  onUpdate: (findingId: string, patch: FindingPatch) => void;
  saveFailed: boolean;
  onRetrySave: () => void;
}

/** The list of findings with its filters, and the panel that opens for one finding. */
export function FindingsSection({ audit, onUpdate, saveFailed, onRetrySave }: FindingsSectionProps) {
  const headingId = useId();
  const [filter, setFilter] = useState<FindingFilter>(NO_FILTER);
  const [sort, setSort] = useState<FindingSort>("severity");
  const [open, setOpen] = useState<OpenFinding | null>(null);

  const { findings } = audit;
  const visible = useMemo(() => sortFindings(filterFindings(findings, filter), sort), [findings, filter, sort]);
  const byStatus = countByStatus(findings);
  const bySeverity = countBySeverity(findings);
  const filtered = filter.status !== "all" || filter.severity !== "all";

  return (
    <section aria-labelledby={headingId}>
      <Card padded={false}>
        <div className="flex flex-col gap-4 border-b border-line px-5 py-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold text-ink">
              Findings
            </h2>
            <p className="mt-1 text-sm text-muted" role="status">
              {filtered
                ? `Showing ${formatCount(visible.length)} of ${plural(findings.length, "finding")}.`
                : `${plural(findings.length, "finding")}. Open one to see its evidence and how its number was worked out.`}
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-3 sm:flex sm:items-end">
            <Select
              label="Status"
              className="sm:w-44"
              value={filter.status}
              onChange={(e) => setFilter({ ...filter, status: e.target.value as FindingFilter["status"] })}
            >
              <option value="all">All ({formatCount(findings.length)})</option>
              {FINDING_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} ({formatCount(byStatus[s.value])})
                </option>
              ))}
            </Select>
            <Select
              label="Severity"
              className="sm:w-40"
              value={filter.severity}
              onChange={(e) => setFilter({ ...filter, severity: e.target.value as FindingFilter["severity"] })}
            >
              <option value="all">All ({formatCount(findings.length)})</option>
              {SEVERITIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} ({formatCount(bySeverity[s.value])})
                </option>
              ))}
            </Select>
            <Select
              label="Sort by"
              className="col-span-2 sm:w-48"
              value={sort}
              onChange={(e) => setSort(e.target.value as FindingSort)}
            >
              <option value="severity">Severity, then estimate</option>
              <option value="impact">Largest estimate first</option>
            </Select>
          </div>
        </div>

        {visible.length > 0 ? (
          <ul className="divide-y divide-line">
            {visible.map((finding) => (
              <FindingRow
                key={finding.id}
                finding={finding}
                onOpen={(id) => setOpen({ id, order: visible.map((f) => f.id) })}
              />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center px-5 py-10 text-center">
            <SearchX className="h-8 w-8 text-muted" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-ink">No findings match these filters</p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => setFilter(NO_FILTER)}>
              Show all findings
            </Button>
          </div>
        )}
      </Card>

      <FindingDrawer
        findings={findings}
        open={open}
        onNavigate={(id) => setOpen((current) => (current ? { ...current, id } : current))}
        onClose={() => setOpen(null)}
        onUpdate={onUpdate}
        saveFailed={saveFailed}
        onRetrySave={onRetrySave}
      />
    </section>
  );
}
