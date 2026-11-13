import { useState } from "react";
import { ArrowRight, FileText, FlaskConical, Trash2 } from "lucide-react";
import { FileDropzone } from "./FileDropzone";
import { FileSummary } from "./FileSummary";
import { ReaderChoice } from "./ReaderChoice";
import { StepFooter, StepShell } from "./StepShell";
import { Button, Modal, Notice, ProgressBar } from "@/components/ui";
import { AI_READER_AVAILABLE } from "@/lib/aiReader";
import { formatBytes, plural } from "@/lib/format";
import { MAX_PDF_BYTES, MAX_PDF_PAGES } from "@/lib/pdf";
import { readingNotes } from "@/lib/terms";
import { useDraftAuditStore, type ContractState } from "@/store/useDraftAuditStore";

/** What is happening while a contract is being read, in words. */
function readingStatus(contract: ContractState): string {
  if (contract.stage === "ai") {
    return contract.pagesDone > 0
      ? `Gemini has read ${contract.pagesDone} of ${plural(contract.pagesTotal, "page")}`
      : "Gemini is reading the contract. This can take a minute or two.";
  }
  if (contract.source === "sample") return "Loading the sample";
  if (contract.stage === "terms") return "Finding contract terms";
  if (contract.stage === "pages" && contract.pagesTotal > 0) {
    return `Read ${contract.pagesDone} of ${plural(contract.pagesTotal, "page")}`;
  }
  return "Opening the file";
}

/** Step 1: add the contract PDF, or load the built-in sample. */
export function UploadStep({ focusHeading }: { focusHeading: boolean }) {
  const contract = useDraftAuditStore((s) => s.contract);
  const termCount = useDraftAuditStore((s) => s.terms.length);
  const keepsClaims = useDraftAuditStore((s) => s.claims.source === "upload");
  const loadContract = useDraftAuditStore((s) => s.loadContract);
  const loadSample = useDraftAuditStore((s) => s.loadSample);
  const cancelContract = useDraftAuditStore((s) => s.cancelContract);
  const removeContract = useDraftAuditStore((s) => s.removeContract);
  const retryAiReading = useDraftAuditStore((s) => s.retryAiReading);
  const switchToBuiltInReader = useDraftAuditStore((s) => s.switchToBuiltInReader);
  const waitingForConsent = useDraftAuditStore((s) => AI_READER_AVAILABLE && s.reader === "gemini" && !s.aiConsent);
  const mayAskGemini = useDraftAuditStore((s) => AI_READER_AVAILABLE && s.reader === "gemini" && s.aiConsent);
  const nextStep = useDraftAuditStore((s) => s.nextStep);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [dropError, setDropError] = useState("");
  const [retryRefused, setRetryRefused] = useState(false);

  const { status } = contract;
  const sample = contract.source === "sample";
  const withGemini = contract.reader === "gemini";
  const pagesKnown = (contract.stage === "pages" || (contract.stage === "ai" && contract.pagesDone > 0)) && contract.pagesTotal > 0;
  const blocked = waitingForConsent ? "Tick the box below to agree to send this contract's text to Google Gemini, or choose the built-in reader." : undefined;
  const report = contract.aiReport;
  const notes = report ? readingNotes(report) : null;

  return (
    <StepShell
      title="Upload contract"
      description={
        AI_READER_AVAILABLE
          ? "Add the contract as a text-based PDF. The file is read here in your browser and is never uploaded. If you choose the Gemini reader, the text of its pages is sent to Google Gemini."
          : "Add the contract as a text-based PDF. It is read here in your browser and is never uploaded."
      }
      focusHeading={focusHeading}
      view={status}
    >
      {status === "error" && contract.error && contract.aiFailure ? (
        <Notice
          tone="error"
          title={contract.fileName ? `Gemini could not read ${contract.fileName}` : "Gemini could not read the contract"}
          className="mb-4"
        >
          <p>{contract.error}</p>
          <p className="mt-1">
            {contract.aiFailure.retryable
              ? "Nothing has been read in its place. You can ask Gemini again, or have the built-in reader read this contract on this device instead."
              : "Nothing has been read in its place. You can have the built-in reader read this contract on this device instead."}
          </p>
          {retryRefused && !mayAskGemini ? (
            <p className="mt-1" role="status">
              To ask Gemini again, choose the Gemini reader below and tick the box to agree.
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {contract.aiFailure.retryable ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  // The agreement can have been withdrawn since the failure. Nothing is sent without it.
                  setRetryRefused(!mayAskGemini);
                  if (mayAskGemini) void retryAiReading();
                }}
              >
                Try Gemini again
              </Button>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => void switchToBuiltInReader()}>
              Use the built-in reader instead
            </Button>
          </div>
        </Notice>
      ) : status === "error" && contract.error ? (
        <Notice tone="error" title={contract.fileName ? `${contract.fileName} could not be used` : undefined} className="mb-4">
          {contract.error}
        </Notice>
      ) : dropError ? (
        <Notice tone="error" className="mb-4">
          {dropError}
        </Notice>
      ) : null}

      {status === "empty" || status === "error" ? (
        <>
          {AI_READER_AVAILABLE ? <ReaderChoice /> : null}
          <FileDropzone
            accept="application/pdf,.pdf"
            title="Drag and drop your contract PDF here"
            buttonLabel="Choose PDF"
            icon={<FileText className="h-6 w-6" />}
            hint={`One PDF, up to ${MAX_PDF_PAGES} pages and ${formatBytes(MAX_PDF_BYTES)}. Scanned copies have no text to read, so they cannot be used.`}
            onFile={(file) => {
              setDropError("");
              void loadContract(file);
            }}
            onReject={setDropError}
            blocked={blocked}
          />
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line p-4 @lg:flex-row @lg:items-center @lg:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">No contract to hand?</p>
              <p className="mt-0.5 text-sm text-muted">
                Try a made-up agreement and 300 made-up claims with problems planted in them.
              </p>
            </div>
            <Button
              variant="secondary"
              className="shrink-0"
              icon={<FlaskConical className="h-4 w-4" />}
              onClick={() => {
                setDropError(blocked ?? "");
                if (!blocked) void loadSample();
              }}
            >
              Try the sample
            </Button>
          </div>
        </>
      ) : null}

      {status === "reading" ? (
        <FileSummary
          icon={<FileText className="h-5 w-5" />}
          name={sample ? "Sample contract" : contract.fileName}
          details={contract.fileSize === null ? [] : [formatBytes(contract.fileSize)]}
          sample={sample}
          action={
            sample && !withGemini ? undefined : (
              <Button variant="secondary" size="sm" onClick={cancelContract}>
                Cancel
              </Button>
            )
          }
        >
          <ProgressBar
            value={pagesKnown ? contract.pagesDone / contract.pagesTotal : null}
            label={contract.stage === "ai" ? "Gemini is reading the contract" : sample ? "Loading the sample" : `Reading ${contract.fileName}`}
            valueText={readingStatus(contract)}
          />
          <p className="num mt-2 text-xs text-muted">{readingStatus(contract)}</p>
        </FileSummary>
      ) : null}

      {status === "ready" ? (
        <>
          <FileSummary
            icon={<FileText className="h-5 w-5" />}
            name={contract.fileName}
            details={[
              plural(contract.pageCount, "page"),
              ...(contract.fileSize === null ? [] : [formatBytes(contract.fileSize)]),
              termCount === 0 ? "No terms found" : `${plural(termCount, "term")} found`,
              ...(withGemini ? [report?.model ? `Read by Gemini (${report.model})` : "Read by Gemini"] : []),
            ]}
            sample={sample}
            action={
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 className="h-4 w-4" />}
                onClick={() => setConfirmingRemove(true)}
              >
                Remove
              </Button>
            }
          />
          {termCount === 0 ? (
            <Notice tone="warning" className="mt-4" title="No contract terms were found in this file">
              You can add terms by hand in the next step, or remove this file and try another one.
            </Notice>
          ) : null}
          {withGemini && report ? (
            <Notice className="mt-4" title="Gemini read this contract">
              <p>
                Every term is unconfirmed until you have checked it against the quoted wording in the next step.
                {report.observations > 0
                  ? ` ${plural(report.observations, "observation")} about the wording will be added to the report, marked as AI reading.`
                  : ""}
              </p>
              {notes?.leftOut ? <p className="mt-1">{notes.leftOut}</p> : null}
            </Notice>
          ) : null}
          {withGemini && notes?.incomplete ? (
            <Notice tone="warning" className="mt-4" title={notes.incomplete.title}>
              {notes.incomplete.text}
            </Notice>
          ) : null}
        </>
      ) : null}

      <StepFooter note={status === "ready" ? undefined : "Add a contract to continue."}>
        <Button onClick={nextStep} disabled={status !== "ready"}>
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </StepFooter>

      <Modal
        open={confirmingRemove}
        onClose={() => setConfirmingRemove(false)}
        title="Remove this contract?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmingRemove(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmingRemove(false);
                removeContract();
              }}
            >
              Remove contract
            </Button>
          </>
        }
      >
        <p className="text-muted">
          The terms found in it, and any changes you made to them, are removed too.
          {keepsClaims ? " Your claims file stays." : ""}
        </p>
      </Modal>
    </StepShell>
  );
}
