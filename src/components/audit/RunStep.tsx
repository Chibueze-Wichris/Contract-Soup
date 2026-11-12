import type { ReactNode } from "react";
import { CheckCircle2, Circle, Loader2, Play } from "lucide-react";
import { StepFooter, StepShell } from "./StepShell";
import { Button, Input, Notice, ProgressBar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import {
  RUN_PHASES,
  currentSettings,
  defaultAuditName,
  useDraftAuditStore,
  type WizardStep,
} from "@/store/useDraftAuditStore";

interface SummaryRowProps {
  label: string;
  /** Label for the button that goes back to the step this row is about. */
  action?: string;
  onAction?: () => void;
  children: ReactNode;
}

function SummaryRow({ label, action, onAction, children }: SummaryRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="mt-0.5 text-sm text-ink">{children}</dd>
      </div>
      {action && onAction ? (
        <Button variant="ghost" size="sm" className="-mr-2 shrink-0" onClick={onAction}>
          {action}
          <span className="sr-only"> {label.toLowerCase()}</span>
        </Button>
      ) : null}
    </div>
  );
}

/** Step 4: a summary of what will be checked, the audit's name, and the run itself. */
export function RunStep({ focusHeading }: { focusHeading: boolean }) {
  const contract = useDraftAuditStore((s) => s.contract);
  const termCount = useDraftAuditStore((s) => s.terms.length);
  const confirmedCount = useDraftAuditStore((s) => s.terms.filter((t) => t.confirmed).length);
  const claims = useDraftAuditStore((s) => s.claims);
  const auditName = useDraftAuditStore((s) => s.auditName);
  const run = useDraftAuditStore((s) => s.run);
  const setAuditName = useDraftAuditStore((s) => s.setAuditName);
  const goToStep = useDraftAuditStore((s) => s.goToStep);
  const previousStep = useDraftAuditStore((s) => s.previousStep);
  const runAudit = useDraftAuditStore((s) => s.runAudit);

  const running = run.status === "running";
  const result = claims.status === "ready" ? claims.result : null;
  const claimCount = result?.claims.length ?? 0;
  const settings = currentSettings();
  const open = (step: WizardStep) => (running ? undefined : () => goToStep(step));

  return (
    <StepShell
      title="Run audit"
      description="Check what will be used, then run the audit. Everything is worked out here in your browser."
      focusHeading={focusHeading}
      view={run.status}
    >
      <Input
        label="Audit name"
        value={auditName}
        placeholder={defaultAuditName(contract.fileName)}
        hint="How this audit is listed in your saved reports."
        maxLength={120}
        disabled={running}
        className="max-w-md"
        onChange={(e) => setAuditName(e.target.value)}
      />

      <dl className="mt-5 divide-y divide-line rounded-xl border border-line">
        <SummaryRow label="Contract" action="Change" onAction={open(1)}>
          <span className="break-words font-medium [overflow-wrap:anywhere]">{contract.fileName}</span>
          <span className="num block text-muted">{plural(contract.pageCount, "page")}</span>
        </SummaryRow>
        <SummaryRow label="Contract terms" action="Review" onAction={open(2)}>
          <span className="num font-medium">
            {confirmedCount} of {termCount} confirmed
          </span>
          <span className="block text-muted">Only confirmed terms are used.</span>
        </SummaryRow>
        <SummaryRow label="Claims" action={result ? "Change" : "Add"} onAction={open(3)}>
          {result ? (
            <>
              <span className="break-words font-medium [overflow-wrap:anywhere]">{claims.fileName}</span>
              <span className="num block text-muted">
                {plural(claimCount, "row")}
                {result.skippedRows > 0 ? `, with ${plural(result.skippedRows, "row")} left out` : ""}
              </span>
            </>
          ) : (
            <span className="font-medium">No claims file</span>
          )}
        </SummaryRow>
        <SummaryRow label="Thresholds">
          <span className="num text-muted">
            Fee differences under {settings.feeTolerancePct}% are ignored. A charge counts as unusually high when it is
            more than {settings.outlierSigma} standard deviations above the average for its category.
          </span>
        </SummaryRow>
      </dl>

      {!result ? (
        <Notice tone="warning" className="mt-4" title="There is no claims file">
          Without claims, nothing you were charged can be checked. You can still run the audit to keep a record of the
          contract terms.
        </Notice>
      ) : confirmedCount === 0 ? (
        <Notice tone="warning" className="mt-4" title="No terms are confirmed">
          Your claims will not be checked against the contract. Go back to review the terms and confirm the ones that
          are right.
        </Notice>
      ) : null}

      {running ? (
        <div className="mt-5 rounded-xl border border-line bg-surface-2 p-4">
          <ProgressBar
            value={(run.phase + 1) / (RUN_PHASES.length + 1)}
            label="Running the audit"
            valueText={RUN_PHASES[run.phase]}
          />
          <ol className="mt-4 space-y-2">
            {RUN_PHASES.map((phase, i) => (
              <li
                key={phase}
                className={cn("flex items-center gap-2 text-sm", i <= run.phase ? "text-ink" : "text-muted")}
              >
                {i < run.phase ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                ) : i === run.phase ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" aria-hidden="true" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                <span className={cn(i === run.phase && "font-medium")}>{phase}</span>
                <span className="sr-only">{i < run.phase ? ", done" : i === run.phase ? ", in progress" : ", waiting"}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted">
            You can leave this page. The audit keeps going and is saved on this device when it finishes.
          </p>
          <p className="sr-only" role="status">
            {RUN_PHASES[run.phase]}
          </p>
        </div>
      ) : null}

      {run.status === "error" && run.error ? (
        <Notice tone="error" className="mt-5" title="The audit did not finish">
          <p>{run.error}</p>
          {run.errorDetail ? <p className="mt-1 break-words text-xs text-muted">Details: {run.errorDetail}</p> : null}
        </Notice>
      ) : null}

      <StepFooter onBack={running ? undefined : previousStep}>
        <Button
          size="lg"
          loading={running}
          icon={<Play className="h-4 w-4" />}
          onClick={() => void runAudit()}
        >
          {running ? "Running the audit" : run.status === "error" ? "Try again" : "Run audit"}
        </Button>
      </StepFooter>
    </StepShell>
  );
}
