import { Link } from "react-router-dom";
import type { AuditListItem } from "@/lib/auditRecord";
import { formatDateTime, formatUsd, plural } from "@/lib/format";
import { RowActions, type RowAction } from "./RowActions";

interface ReportsTableProps {
  items: readonly AuditListItem[];
  busy: { id: string; action: RowAction } | null;
  onAction: (item: AuditListItem, action: RowAction) => void;
}

/** "4 to review", "All reviewed", or nothing when the report has no findings. */
function reviewText(item: AuditListItem): string {
  if (item.findingCount === 0) return "";
  return item.openCount > 0 ? `${item.openCount} to review` : "All reviewed";
}

/**
 * The saved reports. A five-column table when the card is wide enough for one; otherwise the other
 * columns fold into the first cell (beside the name, or under it in a narrow card), so nothing ever
 * scrolls sideways. The switch follows the width of the card and not of the window, because the
 * sidebar takes a varying share of the window. The column widths are fixed, so a very long name wraps
 * inside its own column.
 */
export function ReportsTable({ items, busy, onAction }: ReportsTableProps) {
  return (
    <div className="@container">
      <table className="w-full table-fixed text-left text-sm">
        <caption className="sr-only">Saved reports</caption>
        <thead className="hidden @4xl:table-header-group">
          <tr className="border-b border-line text-xs text-muted">
            <th scope="col" className="py-3 pl-6 pr-3 font-medium">
              Report
            </th>
            <th scope="col" className="w-48 px-3 py-3 font-medium">
              Created
            </th>
            <th scope="col" className="w-28 px-3 py-3 font-medium">
              Findings
            </th>
            <th scope="col" className="w-40 px-3 py-3 text-right font-medium">
              Estimated exposure
            </th>
            <th scope="col" className="w-48 py-3 pl-3 pr-6 text-right font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((item) => {
            const rowBusy = busy?.id === item.id ? busy.action : null;
            const review = reviewText(item);
            return (
              <tr key={item.id} className="align-top">
                <th scope="row" className="px-5 py-4 text-left font-normal sm:px-6 @4xl:py-3.5 @4xl:pr-3">
                  <div className="@xl:flex @xl:items-start @xl:justify-between @xl:gap-6 @4xl:block">
                    <div className="min-w-0">
                      <Link
                        to={`/reports/${item.id}`}
                        className="font-medium text-ink underline-offset-2 [overflow-wrap:anywhere] hover:text-brand hover:underline"
                      >
                        {item.name}
                      </Link>
                      <span className="mt-0.5 block text-xs text-muted [overflow-wrap:anywhere]">{item.contractFileName}</span>
                      <p className="num mt-2 text-xs text-muted @4xl:hidden">{formatDateTime(item.createdAt)}</p>
                    </div>

                    {/* Without columns: what they would show. Under the name in a narrow card, beside it in a wider one. */}
                    <div className="mt-1 shrink-0 @xl:mt-0 @xl:text-right @4xl:hidden">
                      <p className="num text-xs text-muted">
                        <span className="text-sm font-semibold text-ink">{formatUsd(item.exposureUSD)}</span> estimated
                      </p>
                      <p className="num mt-0.5 text-xs text-muted">
                        {plural(item.findingCount, "finding")}
                        {review ? `, ${review.toLowerCase()}` : ""}
                      </p>
                      <RowActions
                        className="-ml-2 mt-2 @xl:-mr-2 @xl:ml-0 @xl:justify-end"
                        reportName={item.name}
                        busy={rowBusy}
                        onAction={(action) => onAction(item, action)}
                      />
                    </div>
                  </div>
                </th>
                <td className="num hidden px-3 py-3.5 text-muted @4xl:table-cell">{formatDateTime(item.createdAt)}</td>
                <td className="num hidden px-3 py-3.5 @4xl:table-cell">
                  <span className="block text-ink">{item.findingCount}</span>
                  {review ? <span className="block text-xs text-muted">{review}</span> : null}
                </td>
                <td className="num hidden px-3 py-3.5 text-right font-medium text-ink [overflow-wrap:anywhere] @4xl:table-cell">
                  {formatUsd(item.exposureUSD)}
                </td>
                <td className="hidden py-2 pl-3 pr-4 @4xl:table-cell">
                  <RowActions
                    className="justify-end"
                    reportName={item.name}
                    busy={rowBusy}
                    onAction={(action) => onAction(item, action)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
