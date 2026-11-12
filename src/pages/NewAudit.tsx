import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { ClaimsStep } from "@/components/audit/ClaimsStep";
import { DROPZONE_SELECTOR, carriesFiles } from "@/components/audit/FileDropzone";
import { ReviewTermsStep } from "@/components/audit/ReviewTermsStep";
import { RunStep } from "@/components/audit/RunStep";
import { Stepper } from "@/components/audit/Stepper";
import { UploadStep } from "@/components/audit/UploadStep";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, Card, Modal, buttonClasses } from "@/components/ui";
import { STORAGE_TEXT } from "@/lib/storageText";
import { isDraftEmpty, useDraftAuditStore } from "@/store/useDraftAuditStore";

/** The New Audit wizard: upload a contract, review its terms, add claims, run the audit. */
export default function NewAudit() {
  const step = useDraftAuditStore((s) => s.step);
  const empty = useDraftAuditStore(isDraftEmpty);
  const running = useDraftAuditStore((s) => s.run.status === "running");
  const finishedAuditId = useDraftAuditStore((s) => s.finishedAuditId);
  const setWizardOpen = useDraftAuditStore((s) => s.setWizardOpen);
  const clearFinished = useDraftAuditStore((s) => s.clearFinished);
  const reset = useDraftAuditStore((s) => s.reset);
  const navigate = useNavigate();
  const [confirmingReset, setConfirmingReset] = useState(false);

  // An audit that finished while this page was closed. It gets a "ready" card instead of a sudden jump to the report.
  const finishedBeforeArriving = useRef(finishedAuditId);
  // False for the step shown on arrival, true for every step after it: only those take keyboard focus.
  const arrived = useRef(false);

  useEffect(() => {
    setWizardOpen(true);
    arrived.current = true;
    return () => setWizardOpen(false);
  }, [setWizardOpen]);

  // The audit finished while this page was open: go straight to its report.
  useEffect(() => {
    if (!finishedAuditId || finishedAuditId === finishedBeforeArriving.current) return;
    clearFinished();
    navigate(`/reports/${finishedAuditId}`);
  }, [finishedAuditId, clearFinished, navigate]);

  // A file dropped beside a drop target would make the browser open it and leave the app, losing the draft.
  useEffect(() => {
    const ignoreStrayDrops = (e: DragEvent): void => {
      if (!carriesFiles(e.dataTransfer?.types)) return;
      const onTarget = e.target instanceof Element && e.target.closest(DROPZONE_SELECTOR) !== null;
      if (onTarget) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", ignoreStrayDrops);
    window.addEventListener("drop", ignoreStrayDrops);
    return () => {
      window.removeEventListener("dragover", ignoreStrayDrops);
      window.removeEventListener("drop", ignoreStrayDrops);
    };
  }, []);

  const finishedEarlier = finishedAuditId !== null && finishedAuditId === finishedBeforeArriving.current;
  const focusHeading = arrived.current;

  return (
    <>
      <PageHeader
        title="New audit"
        description="Four short steps. Your progress is kept if you leave this page, until you reload or close the tab."
        actions={
          empty || finishedEarlier ? undefined : (
            <Button
              variant="secondary"
              icon={<RotateCcw className="h-4 w-4" />}
              disabled={running}
              onClick={() => setConfirmingReset(true)}
            >
              Start over
            </Button>
          )
        }
      />

      {finishedEarlier ? (
        <Card className="flex flex-col items-center py-12 text-center">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success-ink"
            aria-hidden="true"
          >
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <h2 className="mt-4 text-lg font-semibold">Your audit is ready</h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            It finished while you were on another page and is saved {STORAGE_TEXT.savedIn}.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link to={`/reports/${finishedAuditId}`} className={buttonClasses("primary", "md")} onClick={clearFinished}>
              View report
            </Link>
            <Button variant="secondary" onClick={clearFinished}>
              Start another audit
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Stepper />
          {step === 1 ? <UploadStep key={1} focusHeading={focusHeading} /> : null}
          {step === 2 ? <ReviewTermsStep key={2} focusHeading={focusHeading} /> : null}
          {step === 3 ? <ClaimsStep key={3} focusHeading={focusHeading} /> : null}
          {step === 4 ? <RunStep key={4} focusHeading={focusHeading} /> : null}
        </>
      )}

      <Modal
        open={confirmingReset}
        onClose={() => setConfirmingReset(false)}
        title="Start over?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingReset(false)}>
              Keep going
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmingReset(false);
                reset();
              }}
            >
              Start over
            </Button>
          </>
        }
      >
        <p className="text-muted">
          This clears the contract, the terms you reviewed and the claims file from this audit. Saved reports are not
          affected.
        </p>
      </Modal>
    </>
  );
}
