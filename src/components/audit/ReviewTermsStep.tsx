import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCheck, Plus } from "lucide-react";
import { AddTermModal } from "./AddTermModal";
import { StepFooter, StepShell } from "./StepShell";
import { TermDrawer } from "./TermDrawer";
import { TERM_GRID, TermRow } from "./TermRow";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useDraftAuditStore } from "@/store/useDraftAuditStore";

/** Step 2: check each term against the contract wording, correct it, and confirm the ones that are right. */
export function ReviewTermsStep({ focusHeading }: { focusHeading: boolean }) {
  const terms = useDraftAuditStore((s) => s.terms);
  const sample = useDraftAuditStore((s) => s.contract.source === "sample");
  const setTermsConfirmed = useDraftAuditStore((s) => s.setTermsConfirmed);
  const nextStep = useDraftAuditStore((s) => s.nextStep);
  const previousStep = useDraftAuditStore((s) => s.previousStep);

  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  // Counts removals, so focus can be put somewhere sensible after the panel of a removed term closes.
  const [removals, setRemovals] = useState(0);

  useEffect(() => {
    if (removals > 0) addButton.current?.focus();
  }, [removals]);

  const confirmedCount = terms.filter((t) => t.confirmed).length;
  const clearButUnconfirmed = terms.filter((t) => !t.confirmed && t.confidence === "high").map((t) => t.id);

  return (
    <StepShell
      title="Review contract terms"
      description="Check each term against the contract wording and correct anything that was read wrongly. Tick Confirmed on the ones that are right. Only confirmed terms are used to check your claims."
      focusHeading={focusHeading}
    >
      {sample ? (
        <Notice className="mb-5">
          This is the sample agreement. Its clearly worded terms are already confirmed, so you can go straight on.
        </Notice>
      ) : null}

      <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between">
        <p className="text-sm text-muted">
          <span className="num font-semibold text-ink">
            {confirmedCount} of {terms.length}
          </span>{" "}
          {terms.length === 1 ? "term" : "terms"} confirmed
        </p>
        <div className="flex flex-wrap gap-2">
          {clearButUnconfirmed.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<CheckCheck className="h-4 w-4" />}
              onClick={() => setTermsConfirmed(clearButUnconfirmed, true)}
            >
              Confirm all high confidence ({clearButUnconfirmed.length})
            </Button>
          ) : null}
          <Button
            ref={addButton}
            variant="secondary"
            size="sm"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => setAdding(true)}
          >
            Add a term
          </Button>
        </div>
      </div>

      {terms.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center">
          <p className="text-sm font-medium text-ink">No terms were found in this contract</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Add the terms you want checked by hand, or go back and try another file. Without confirmed terms, your claims
            are not checked against the contract.
          </p>
        </div>
      ) : (
        <div className="mt-4">
          <div
            className={cn("hidden border-b border-line pb-2 text-xs font-medium text-muted", TERM_GRID)}
            aria-hidden="true"
          >
            <span>Term</span>
            <span>Value</span>
            <span>Unit</span>
            <span className="pl-2">Wording</span>
            <span className="text-center">Confirmed</span>
          </div>
          <ul className="divide-y divide-line">
            {terms.map((term) => (
              <TermRow key={term.id} term={term} onOpen={setOpenId} />
            ))}
          </ul>
        </div>
      )}

      {terms.length > 0 && confirmedCount === 0 ? (
        <Notice tone="warning" className="mt-4" title="No terms are confirmed yet">
          Only confirmed terms are used, so your claims would not be checked against this contract.
        </Notice>
      ) : null}

      <StepFooter onBack={previousStep}>
        <Button onClick={nextStep}>
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </StepFooter>

      <TermDrawer
        termId={openId}
        onClose={() => setOpenId(null)}
        onOpenTerm={setOpenId}
        onRemoved={() => {
          setOpenId(null);
          setRemovals((n) => n + 1);
        }}
      />
      {adding ? <AddTermModal onClose={() => setAdding(false)} /> : null}
    </StepShell>
  );
}
