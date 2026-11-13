import { useState } from "react";
import { ArrowRight, ChevronRight, Download, Table2, Trash2 } from "lucide-react";
import { ClaimsCheck } from "./ClaimsCheck";
import { ClaimsPreview } from "./ClaimsPreview";
import { ColumnMapper } from "./ColumnMapper";
import { FileDropzone } from "./FileDropzone";
import { FileSummary } from "./FileSummary";
import { StepFooter, StepShell } from "./StepShell";
import { Button, Modal, Notice, ProgressBar } from "@/components/ui";
import {
  CLAIM_FIELDS,
  MAX_CLAIM_ROWS,
  MAX_CSV_BYTES,
  TEMPLATE_FILE_NAME,
  buildTemplateCsv,
} from "@/lib/claimsCsv";
import { downloadTextFile } from "@/lib/download";
import { formatBytes, formatCount, plural } from "@/lib/format";
import { useDraftAuditStore } from "@/store/useDraftAuditStore";

/** Step 3: add the claims CSV, match its columns and see what will be left out. The step can be skipped. */
export function ClaimsStep({ focusHeading }: { focusHeading: boolean }) {
  const claims = useDraftAuditStore((s) => s.claims);
  const loadClaims = useDraftAuditStore((s) => s.loadClaims);
  const removeClaims = useDraftAuditStore((s) => s.removeClaims);
  const nextStep = useDraftAuditStore((s) => s.nextStep);
  const previousStep = useDraftAuditStore((s) => s.previousStep);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [dropError, setDropError] = useState("");

  const { status, table, result } = claims;
  const sample = claims.source === "sample";
  const loaded = status === "ready" && table !== null && result !== null;
  const unusable = loaded && !result.ok;
  // Removing the file only needs a second thought when column or date choices would be lost with it.
  const choicesMade =
    claims.dateOrder !== "auto" || CLAIM_FIELDS.some((f) => claims.mapping[f.key] !== claims.suggested[f.key]);

  function onRemove(): void {
    if (choicesMade) setConfirmingRemove(true);
    else removeClaims();
  }

  return (
    <StepShell
      title="Upload claims"
      description="Optional, but recommended. With a claims file, what you were charged is checked against the confirmed terms. The file is read here in your browser and is never uploaded."
      focusHeading={focusHeading}
      view={status}
    >
      {status === "error" && claims.error ? (
        <Notice tone="error" title={claims.fileName ? `${claims.fileName} could not be used` : undefined} className="mb-4">
          {claims.error}
        </Notice>
      ) : dropError ? (
        <Notice tone="error" className="mb-4">
          {dropError}
        </Notice>
      ) : null}

      {status === "empty" || status === "error" ? (
        <>
          <FileDropzone
            accept=".csv,text/csv"
            title="Drag and drop your claims CSV here"
            buttonLabel="Choose CSV"
            icon={<Table2 className="h-6 w-6" />}
            hint={`One CSV file, up to ${formatCount(MAX_CLAIM_ROWS)} rows and ${formatBytes(MAX_CSV_BYTES)}. From Excel, use File, Save As, CSV.`}
            onFile={(file) => {
              setDropError("");
              void loadClaims(file);
            }}
            onReject={setDropError}
          />
          <div className="mt-4 rounded-xl border border-line p-4">
            <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">What the file needs</p>
                <p className="mt-0.5 text-sm text-muted">
                  One row for each claim or fee. Your column names do not have to match the template. You match them up
                  after adding the file.
                </p>
              </div>
              <Button
                variant="secondary"
                className="shrink-0"
                icon={<Download className="h-4 w-4" />}
                onClick={() => downloadTextFile(TEMPLATE_FILE_NAME, buildTemplateCsv(), "text/csv;charset=utf-8")}
              >
                Download template
              </Button>
            </div>
            <details className="group mt-3">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-md text-sm font-medium text-brand [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="h-4 w-4 shrink-0 transition-transform duration-150 group-open:rotate-90"
                  aria-hidden="true"
                />
                See the columns
              </summary>
              <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm @2xl:grid-cols-2">
                {CLAIM_FIELDS.map((field) => (
                  <div key={field.key}>
                    <dt className="font-medium text-ink">
                      {field.label}
                      <span className="font-normal text-muted">{field.required ? "" : " (optional)"}</span>
                    </dt>
                    <dd className="mt-0.5 text-muted">{field.help}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </div>
        </>
      ) : null}

      {status === "reading" ? (
        <FileSummary
          icon={<Table2 className="h-5 w-5" />}
          name={claims.fileName}
          details={claims.fileSize === null ? [] : [formatBytes(claims.fileSize)]}
          action={
            <Button variant="secondary" size="sm" onClick={removeClaims}>
              Cancel
            </Button>
          }
        >
          <ProgressBar
            value={claims.progress}
            label={`Reading ${claims.fileName}`}
            valueText={`${Math.round(claims.progress * 100)} percent read`}
          />
          <p className="num mt-2 text-xs text-muted">Reading the file, {Math.round(claims.progress * 100)}%</p>
        </FileSummary>
      ) : null}

      {loaded ? (
        <>
          <FileSummary
            icon={<Table2 className="h-5 w-5" />}
            name={claims.fileName}
            details={[
              plural(result.totalRows, "row"),
              plural(table.headers.length, "column"),
              ...(claims.fileSize === null ? [] : [formatBytes(claims.fileSize)]),
            ]}
            sample={sample}
            action={
              <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} onClick={onRemove}>
                Remove
              </Button>
            }
          />
          <ClaimsCheck table={table} result={result} />
          <ColumnMapper
            table={table}
            mapping={claims.mapping}
            suggested={claims.suggested}
            dateOrder={claims.dateOrder}
            result={result}
          />
          <ClaimsPreview table={table} mapping={claims.mapping} result={result} />
        </>
      ) : null}

      <StepFooter
        onBack={previousStep}
        note={
          status === "reading"
            ? "Wait for the file to be read, or cancel it."
            : unusable
              ? "Sort out the problems above, or remove the file to go on without claims."
              : loaded
                ? undefined
                : "Without claims, nothing you were charged can be checked."
        }
      >
        <Button onClick={nextStep} disabled={status === "reading" || unusable}>
          {loaded ? "Continue" : "Continue without claims"}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </StepFooter>

      <Modal
        open={confirmingRemove}
        onClose={() => setConfirmingRemove(false)}
        title="Remove this claims file?"
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
                removeClaims();
              }}
            >
              Remove file
            </Button>
          </>
        }
      >
        <p className="text-muted">The choices you made for its columns and dates are removed too.</p>
      </Modal>
    </StepShell>
  );
}
