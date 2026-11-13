import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Download } from "lucide-react";
import type { Audit } from "@/analyzer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyBowl } from "@/components/illustrations/EmptyBowl";
import { FindingsSection } from "@/components/report/FindingsSection";
import { ReportSummary } from "@/components/report/ReportSummary";
import { TermsUsed } from "@/components/report/TermsUsed";
import { Button, Card, Notice, PageSkeleton, buttonClasses, toast } from "@/components/ui";
import { geminiName, usedGemini } from "@/lib/analyzerText";
import { STORAGE_PLACE } from "@/lib/auditRepo";
import { isAiFinding } from "@/lib/findings";
import { formatCount, formatDateTime, plural } from "@/lib/format";
import { useAudit, type FindingPatch } from "@/lib/useAudit";

/** Shown when no audit is stored under the id in the address. */
function MissingReport() {
  return (
    <>
      <PageHeader title="Audit report" />
      <Card className="flex flex-col items-center py-12 text-center">
        <EmptyBowl className="h-32 w-auto" />
        <h2 className="mt-6 text-lg font-semibold">
          {STORAGE_PLACE === "account" ? "This report is not in your account" : "This report is not on this device"}
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          {STORAGE_PLACE === "account"
            ? "It may have been deleted, or it may belong to a different account. A report made in this browser before reports were kept in accounts can be moved into yours from Saved reports."
            : "Reports are kept in the browser they were made in. This one may have been made in another browser, it may have been deleted, or this browser's saved data was cleared."}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link to="/audit/new" className={buttonClasses("primary", "md")}>
            Start new audit
          </Link>
          <Link to="/reports" className={buttonClasses("secondary", "md")}>
            Saved reports
          </Link>
        </div>
      </Card>
    </>
  );
}

interface ReportBodyProps {
  audit: Audit;
  onUpdate: (findingId: string, patch: FindingPatch) => void;
  /** Why the latest change could not be saved, or null when everything is saved. */
  saveError: string | null;
  onRetrySave: () => void;
}

function ReportBody({ audit, onUpdate, saveError, onRetrySave }: ReportBodyProps) {
  const [exporting, setExporting] = useState(false);
  const confirmedTerms = audit.terms.filter((t) => t.confirmed).length;
  const hasClaims = audit.claimsCount > 0;
  const withGemini = usedGemini(audit);
  const observations = audit.findings.filter(isAiFinding).length;

  async function downloadPdf(): Promise<void> {
    setExporting(true);
    try {
      // Loaded on demand: the PDF library is large and only needed here.
      const { downloadReportPdf } = await import("@/lib/reportPdf");
      await downloadReportPdf(audit);
      toast.success("The PDF report is in your downloads.");
    } catch (err) {
      console.error("ContractSoup could not create the PDF report", err);
      toast.error("The PDF could not be created. Try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <Link
        to="/reports"
        className="mb-3 inline-flex items-center gap-1.5 rounded-md text-sm text-muted transition-colors duration-150 hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Saved reports
      </Link>
      <PageHeader
        title={audit.name}
        description={[
          `Created ${formatDateTime(audit.createdAt)}`,
          `${audit.contractFileName}, ${plural(audit.pageCount, "page")}`,
          hasClaims ? `${plural(audit.claimsCount, "claim")} checked` : "no claims file",
        ].join(" · ")}
        actions={
          <Button icon={<Download className="h-4 w-4" />} loading={exporting} onClick={() => void downloadPdf()}>
            Download PDF
          </Button>
        }
      />

      <div className="space-y-6">
        {saveError ? (
          <Notice tone="error" title="Your last change was not saved">
            <p>{saveError}</p>
            <p className="mt-1">It is shown here, but it will be lost when you leave this page.</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={onRetrySave}>
              Try again
            </Button>
          </Notice>
        ) : null}

        {withGemini ? (
          <Notice title={`${geminiName(audit)} read this contract`}>
            <p>
              The contract terms were found by Gemini and confirmed by a person before the money checks used them.
              {observations > 0
                ? ` ${plural(observations, "finding")} marked AI reading ${observations === 1 ? "is an observation" : "are observations"} Gemini made about the wording. ${observations === 1 ? "It carries" : "They carry"} no dollar estimate and ${observations === 1 ? "is" : "are"} not part of the estimated exposure.`
                : ""}
            </p>
            <p className="mt-1">
              Everything Gemini reported quotes the contract, and each quotation was checked against the PDF. An AI
              reading can still be wrong or incomplete. It is not legal advice.
            </p>
          </Notice>
        ) : null}

        {!hasClaims ? (
          <Notice tone="warning" title="This audit ran without a claims file">
            Nothing you were charged was checked. Run a new audit with your claims to look for overcharges.
          </Notice>
        ) : confirmedTerms === 0 ? (
          <Notice tone="warning" title="No contract terms were confirmed">
            The claims were not checked against the contract. Only duplicate claims and unusually high charges were
            looked for.
          </Notice>
        ) : null}

        {audit.findings.length > 0 ? (
          <>
            <ReportSummary audit={audit} />
            <FindingsSection audit={audit} onUpdate={onUpdate} saveError={saveError} onRetrySave={onRetrySave} />
          </>
        ) : (
          <Card className="flex flex-col items-center py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success-ink" aria-hidden="true">
              <CheckCircle2 className="h-6 w-6" />
            </span>
            <h2 className="mt-4 text-lg font-semibold">No problems were found</h2>
            <p className="mt-2 max-w-md text-sm text-muted">
              {hasClaims
                ? `${plural(audit.claimsCount, "claim")} ${audit.claimsCount === 1 ? "was" : "were"} checked against ${plural(confirmedTerms, "confirmed contract term")}.`
                : "Without claims there was nothing to compare with the contract."}
            </p>
            <Link to="/audit/new" className={buttonClasses("secondary", "md", "mt-5")}>
              Start new audit
            </Link>
          </Card>
        )}

        <TermsUsed audit={audit} />

        <p className="break-words text-xs text-muted">
          {withGemini
            ? `The contract was read by ${geminiName(audit)}. The money checks were worked out on this device. Analyzer ${audit.analyzerVersion}.`
            : `Worked out on this device by analyzer ${audit.analyzerVersion}.`}{" "}
          The dollar figures are estimates from the {formatCount(audit.pageCount)}-page contract and the claims you
          provided.
        </p>
      </div>
    </>
  );
}

/** One saved audit: the headline figures, the findings to review, and the contract terms they were checked against. */
export default function Report() {
  const { id } = useParams<{ id: string }>();
  const { load, saveError, reload, updateFinding, retrySave } = useAudit(id);

  if (load.status === "loading") return <PageSkeleton />;
  if (load.status === "missing") return <MissingReport />;
  if (load.status === "error") {
    return (
      <>
        <PageHeader title="Audit report" />
        <Notice tone="error" title="This report could not be opened">
          <p>{load.message}</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={reload}>
            Try again
          </Button>
        </Notice>
      </>
    );
  }
  return <ReportBody audit={load.audit} onUpdate={updateFinding} saveError={saveError} onRetrySave={retrySave} />;
}
