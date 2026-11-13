import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui";
import type { AuditListItem } from "@/lib/auditRecord";
import { formatDateTime, formatUsd, plural } from "@/lib/format";

interface RecentAuditsProps {
  /** Newest first. Only the first few are shown. */
  items: readonly AuditListItem[];
  /** How many reports are saved in all. */
  total: number;
}

const SHOWN = 5;

/** The latest few audits on the dashboard, each a link to its report. */
export function RecentAudits({ items, total }: RecentAuditsProps) {
  return (
    <Card padded={false}>
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
        <h2 className="text-base font-semibold text-ink">Recent audits</h2>
        <Link to="/reports" className="shrink-0 text-sm font-medium text-brand underline-offset-2 hover:underline">
          View all {plural(total, "report")}
        </Link>
      </div>
      <ul className="divide-y divide-line">
        {items.slice(0, SHOWN).map((item) => (
          <li key={item.id}>
            <Link
              to={`/reports/${item.id}`}
              className="flex items-start gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-offset-[-2px] sm:px-6"
            >
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium text-ink">{item.name}</span>
                <span className="num mt-0.5 block break-words text-xs text-muted [overflow-wrap:anywhere]">
                  {formatDateTime(item.createdAt)} · {item.contractFileName}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="num block text-sm font-semibold text-ink">{formatUsd(item.exposureUSD)}</span>
                <span className="num block text-xs text-muted">
                  {item.findingCount === 0
                    ? "No findings"
                    : item.openCount > 0
                      ? `${item.openCount} of ${item.findingCount} to review`
                      : `${plural(item.findingCount, "finding")}, all reviewed`}
                </span>
              </span>
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
