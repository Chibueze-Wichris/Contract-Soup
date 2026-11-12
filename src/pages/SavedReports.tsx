import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { SearchX } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyBowl } from "@/components/illustrations/EmptyBowl";
import { DeleteReportModal } from "@/components/saved/DeleteReportModal";
import { DeviceReportsNotice } from "@/components/saved/DeviceReportsNotice";
import { RenameReportModal } from "@/components/saved/RenameReportModal";
import { ReportsTable } from "@/components/saved/ReportsTable";
import type { RowAction } from "@/components/saved/RowActions";
import { Button, Card, Input, Notice, Select, Skeleton, buttonClasses, toast } from "@/components/ui";
import { toListItem, type AuditListItem } from "@/lib/auditRecord";
import { AuditStorageError, STORAGE_PLACE, auditRepo } from "@/lib/auditRepo";
import { formatCount, plural } from "@/lib/format";
import { REPORT_SORTS, searchReports, sortReports, type ReportSort } from "@/lib/reportList";
import { useAuditList } from "@/lib/useAuditList";

const GONE = "This report no longer exists. It may have been deleted in another tab.";

/** How many reports are drawn at a time. More arrive with "Show more", so a long list stays quick. */
const PAGE = 50;

/** Every finished audit: search it, open it, rename it, copy it, download its PDF or delete it. */
export default function SavedReports() {
  const { state, reload, refresh, change } = useAuditList();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ReportSort>("newest");
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<{ id: string; action: RowAction } | null>(null);
  const [renaming, setRenaming] = useState<AuditListItem | null>(null);
  const [deleting, setDeleting] = useState<AuditListItem | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const list = state.status === "ready" ? state.list : null;
  // The list follows the typing a beat behind, so the search box never stutters.
  const search = useDeferredValue(query);
  const matching = useMemo(() => (list ? sortReports(searchReports(list.items, search), sort) : []), [list, search, sort]);
  const visible = matching.slice(0, shown);
  const searching = search.trim() !== "";
  const unreadable = list?.unreadable ?? 0;
  const unreadableNote =
    unreadable > 0 ? `${plural(unreadable, "saved report")} could not be read and ${unreadable === 1 ? "is" : "are"} not shown.` : null;

  async function onAction(item: AuditListItem, action: RowAction): Promise<void> {
    if (action === "rename") return setRenaming(item);
    if (action === "delete") return setDeleting(item);

    setBusy({ id: item.id, action });
    try {
      if (action === "duplicate") {
        const copy = await auditRepo.duplicate(item.id);
        change((items) => [toListItem(copy), ...items]);
        toast.success(`Saved a copy named "${copy.name}".`);
      } else {
        const audit = await auditRepo.get(item.id);
        if (!audit) throw new AuditStorageError(GONE, "gone");
        // Loaded on demand: the PDF library is large and only needed here.
        const { downloadReportPdf } = await import("@/lib/reportPdf");
        await downloadReportPdf(audit);
        toast.success("The PDF report is in your downloads.");
      }
    } catch (err) {
      if (!(err instanceof AuditStorageError)) console.error(`ContractSoup could not ${action} a report`, err);
      toast.error(
        err instanceof AuditStorageError
          ? err.message
          : action === "duplicate"
            ? "The copy could not be saved. Try again."
            : "The PDF could not be created. Try again.",
      );
    } finally {
      setBusy(null);
      if (action === "duplicate") refresh();
    }
  }

  return (
    <>
      <PageHeader
        title="Saved reports"
        description={
          STORAGE_PLACE === "account"
            ? "Audits saved in your account. Your contract and claims files are never uploaded."
            : "Audits saved on this device. Nothing is stored on a server."
        }
      />

      {STORAGE_PLACE === "account" ? <DeviceReportsNotice onMoved={refresh} /> : null}

      {state.status === "loading" ? (
        <Card role="status" aria-label="Loading your reports" className="space-y-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </Card>
      ) : state.status === "error" ? (
        <Notice tone="error" title="Your reports could not be shown">
          <p>{state.message}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={reload}>
            Try again
          </Button>
        </Notice>
      ) : state.list.items.length === 0 ? (
        <Card className="flex flex-col items-center py-12 text-center">
          <EmptyBowl className="h-32 w-auto" />
          <h2 className="mt-6 text-lg font-semibold">No saved reports</h2>
          <p className="mt-2 max-w-sm text-sm text-muted">
            Finished audits appear here so you can reopen, rename or export them.
          </p>
          {unreadableNote ? (
            <p className="mt-2 max-w-sm text-sm text-muted">
              {unreadableNote} "Delete all reports" in Settings removes {unreadable === 1 ? "it" : "them"}.
            </p>
          ) : null}
          <Link to="/audit/new" className={buttonClasses("primary", "md", "mt-5")}>
            Start new audit
          </Link>
        </Card>
      ) : (
        <Card padded={false}>
          <div className="flex flex-col gap-4 border-b border-line px-5 py-4 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-ink focus:outline-none">
                Reports
              </h2>
              <p className="mt-1 text-sm text-muted" role="status">
                {searching
                  ? `${formatCount(matching.length)} of ${plural(state.list.items.length, "report")} ${matching.length === 1 ? "matches" : "match"}.`
                  : `${plural(state.list.items.length, "report")}.`}
              </p>
            </div>
            <div className="grid shrink-0 gap-3 sm:grid-cols-2 lg:flex lg:items-end">
              <Input
                label="Search"
                type="search"
                className="lg:w-64"
                value={query}
                placeholder="Name or contract file"
                autoComplete="off"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setShown(PAGE);
                }}
              />
              <Select
                label="Sort by"
                className="lg:w-56"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as ReportSort);
                  setShown(PAGE);
                }}
              >
                {REPORT_SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {state.list.total > state.list.items.length ? (
            <p className="border-b border-line px-5 py-3 text-sm text-muted sm:px-6">
              These are your {formatCount(state.list.items.length)} most recent reports, of {formatCount(state.list.total)}.
              Delete ones you no longer need to reach the older ones.
            </p>
          ) : null}
          {unreadableNote ? <p className="border-b border-line px-5 py-3 text-sm text-muted sm:px-6">{unreadableNote}</p> : null}

          {visible.length > 0 ? (
            <>
              <ReportsTable items={visible} busy={busy} onAction={(item, action) => void onAction(item, action)} />
              {matching.length > visible.length ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 sm:px-6">
                  <p className="text-sm text-muted">
                    Showing the first {formatCount(visible.length)} of {formatCount(matching.length)}.
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setShown((n) => n + PAGE)}>
                    Show {formatCount(Math.min(PAGE, matching.length - visible.length))} more
                  </Button>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col items-center px-5 py-10 text-center">
              <SearchX className="h-8 w-8 text-muted" aria-hidden="true" />
              <p className="mt-3 break-words text-sm font-medium text-ink [overflow-wrap:anywhere]">
                No reports match "{search.trim()}"
              </p>
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </div>
          )}
        </Card>
      )}

      <RenameReportModal
        report={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={(id, name) => {
          setRenaming(null);
          change((items) => items.map((item) => (item.id === id ? { ...item, name } : item)));
          toast.success("Report renamed.");
          refresh();
        }}
      />
      <DeleteReportModal
        report={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => {
          setDeleting(null);
          change((items) => items.filter((item) => item.id !== id));
          toast.success("Report deleted.");
          refresh();
          // The row that had focus is gone, so put focus somewhere sensible.
          window.setTimeout(() => headingRef.current?.focus(), 0);
        }}
      />
    </>
  );
}
