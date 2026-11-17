import { Link, useNavigate } from "react-router-dom";
import { FilePlus2, FlaskConical } from "lucide-react";
import { RecentAudits } from "@/components/dashboard/RecentAudits";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyBowl } from "@/components/illustrations/EmptyBowl";
import { Button, Card, Notice, Skeleton, buttonClasses, toast } from "@/components/ui";
import { AI_READER_AVAILABLE } from "@/lib/aiReader";
import { formatCount, formatUsd } from "@/lib/format";
import { totalReports } from "@/lib/reportList";
import { STORAGE_TEXT } from "@/lib/storageText";
import { useAuditList } from "@/lib/useAuditList";

/** The front page: totals across every saved audit, the latest few, and the way into a new one. */
export default function Dashboard() {
  const navigate = useNavigate();
  const { state, reload } = useAuditList();
  const list = state.status === "ready" ? state.list : null;
  const totals = list ? totalReports(list.items) : null;
  const capped = list !== null && list.total > list.items.length;

  /** Loads the built-in sample into the New Audit wizard, unless an audit is already under way there. */
  async function trySample(): Promise<void> {
    try {
      // Loaded on demand, so the wizard's code is not part of the dashboard.
      const { isDraftEmpty, useDraftAuditStore } = await import("@/store/useDraftAuditStore");
      const draft = useDraftAuditStore.getState();
      if (isDraftEmpty(draft)) void draft.loadSample();
      else toast.info("You already have an audit under way. Use Start over to load the sample instead.");
    } catch {
      // The New Audit page shows its own error if its code cannot be loaded.
    }
    navigate("/audit/new");
  }

  const sampleButton = (size: "md" | "lg") => (
    <Button variant="secondary" size={size} icon={<FlaskConical className="h-4 w-4" />} onClick={() => void trySample()}>
      Try a sample audit
    </Button>
  );

  const stats = [
    {
      label: "Audits run",
      value: list && totals ? formatCount(list.total) : null,
      hint: `Saved ${STORAGE_TEXT.savedIn}`,
    },
    {
      label: "Estimated exposure",
      value: totals ? formatUsd(totals.exposureUSD) : null,
      hint: "Across findings that are not dismissed",
    },
    {
      label: "Open findings",
      value: totals ? formatCount(totals.openFindings) : null,
      hint: "Waiting for your review",
    },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Check healthcare insurance contracts for hidden fees, unusual charges and pricing problems."
        actions={list && list.items.length > 0 ? sampleButton("md") : undefined}
      />

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <h2 className="text-sm font-normal text-muted">{s.label}</h2>
            {s.value !== null ? (
              <p className="num mt-2 text-xl font-semibold text-ink">{s.value}</p>
            ) : state.status === "loading" ? (
              <Skeleton className="mt-2 h-7 w-24" />
            ) : (
              <p className="mt-2 text-xl font-semibold text-muted">
                <span aria-hidden="true">–</span>
                <span className="sr-only">Not available</span>
              </p>
            )}
            <p className="mt-1 text-xs text-muted">{s.hint}</p>
          </Card>
        ))}
      </section>
      {capped && list ? (
        <p className="mt-2 text-xs text-muted">
          Exposure and open findings cover your {formatCount(list.items.length)} most recent audits.
        </p>
      ) : null}

      <div className="mt-6">
        {state.status === "loading" ? (
          <Card role="status" aria-label="Loading your audits" className="space-y-4">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </Card>
        ) : state.status === "error" ? (
          <Notice tone="error" title="Your audits could not be shown">
            <p>{state.message}</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={reload}>
              Try again
            </Button>
          </Notice>
        ) : state.list.items.length > 0 ? (
          <RecentAudits items={state.list.items} total={state.list.total} />
        ) : (
          <Card className="flex flex-col items-center py-12 text-center">
            <EmptyBowl className="h-36 w-auto" />
            <h2 className="mt-6 text-lg font-semibold">No audits yet</h2>
            <p className="mt-2 max-w-md text-sm text-muted">
              Upload a contract PDF and an optional claims file. ContractSoup reads both in your browser and lists
              anything worth a closer look, with the page and clause as evidence.
              {AI_READER_AVAILABLE ? " For a deeper reading of the wording, you can have Google Gemini read the contract's text." : ""}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/audit/new" className={buttonClasses("primary", "lg", "gap-2")}>
                <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                Start new audit
              </Link>
              {sampleButton("lg")}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
