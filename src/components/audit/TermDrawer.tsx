import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import type { ContractTerm } from "@/analyzer";
import { categoryLabel } from "@/analyzer/categories";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { HighlightedSnippet } from "./HighlightedSnippet";
import { ConfirmBox, UnitOptions, useTermValueField } from "./TermFields";
import { Badge, Button, Drawer, Input, Select, Textarea } from "@/components/ui";
import { isManualTerm, termTitle } from "@/lib/terms";
import { useDraftAuditStore } from "@/store/useDraftAuditStore";

interface TermDrawerProps {
  /** The term to show, or null to keep the panel closed. */
  termId: string | null;
  onClose: () => void;
  /** Moves the panel to another term. */
  onOpenTerm: (id: string) => void;
  /** Called after the shown term has been removed. */
  onRemoved: () => void;
}

/** Side panel for one term: the contract wording it came from, its value and unit, and Confirmed. */
export function TermDrawer({ termId, onClose, onOpenTerm, onRemoved }: TermDrawerProps) {
  const terms = useDraftAuditStore((s) => s.terms);
  const fileName = useDraftAuditStore((s) => s.contract.fileName);
  const pageCount = useDraftAuditStore((s) => s.contract.pageCount);
  const updateTerm = useDraftAuditStore((s) => s.updateTerm);

  const index = termId === null ? -1 : terms.findIndex((t) => t.id === termId);
  const term = index === -1 ? null : terms[index];
  const previous = index > 0 ? terms[index - 1] : null;
  const next = index !== -1 && index < terms.length - 1 ? terms[index + 1] : null;
  const position = `Term ${index + 1} of ${terms.length}`;

  function onPrimary(): void {
    if (!term) return;
    if (term.confirmed) {
      onClose();
      return;
    }
    updateTerm(term.id, { confirmed: true });
    if (next) onOpenTerm(next.id);
  }

  return (
    <Drawer
      open={term !== null}
      onClose={onClose}
      title={term ? termTitle(term) : "Contract term"}
      description={position}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="w-10 px-0"
              aria-label="Previous term"
              disabled={!previous}
              onClick={() => previous && onOpenTerm(previous.id)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="secondary"
              className="w-10 px-0"
              aria-label="Next term"
              disabled={!next}
              onClick={() => next && onOpenTerm(next.id)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <Button data-autofocus onClick={onPrimary}>
            {term?.confirmed ? "Done" : next ? "Confirm and next" : "Confirm"}
          </Button>
        </div>
      }
    >
      {term ? (
        <>
          {/* Read out when Previous or Next changes the term, since focus stays on the button. */}
          <p className="sr-only" aria-live="polite">
            {position}: {termTitle(term)}
          </p>
          <TermDetails key={term.id} term={term} fileName={fileName} pageCount={pageCount} onRemoved={onRemoved} />
        </>
      ) : null}
    </Drawer>
  );
}

interface TermDetailsProps {
  term: ContractTerm;
  fileName: string;
  pageCount: number;
  onRemoved: () => void;
}

function TermDetails({ term, fileName, pageCount, onRemoved }: TermDetailsProps) {
  const updateTerm = useDraftAuditStore((s) => s.updateTerm);
  const removeTerm = useDraftAuditStore((s) => s.removeTerm);
  const valueField = useTermValueField(term);
  const manual = isManualTerm(term);
  const [pageText, setPageText] = useState(String(term.pageRef));
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const removeButton = useRef<HTMLButtonElement>(null);

  const pageNumber = Number(pageText);
  const pageValid = /^\d+$/.test(pageText.trim()) && pageNumber >= 1 && pageNumber <= pageCount;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceBadge term={term} />
        {/* The category is only worth showing when the term has a name of its own. */}
        {termTitle(term) === categoryLabel(term.category) ? null : <Badge>{categoryLabel(term.category)}</Badge>}
      </div>

      {manual ? (
        <div className="grid gap-4">
          <Input
            label="Name"
            value={term.label}
            placeholder={categoryLabel(term.category)}
            hint="For a fee, use the name it has in your claims file."
            maxLength={120}
            onChange={(e) => updateTerm(term.id, { label: e.target.value })}
          />
          <Input
            label="Page"
            inputMode="numeric"
            className="max-w-44"
            value={pageText}
            error={pageValid ? undefined : `Enter a page from 1 to ${pageCount}.`}
            onChange={(e) => {
              setPageText(e.target.value);
              const n = Number(e.target.value);
              if (/^\d+$/.test(e.target.value.trim()) && n >= 1 && n <= pageCount) updateTerm(term.id, { pageRef: n });
            }}
          />
          <Textarea
            label="Contract wording"
            rows={5}
            value={term.snippet}
            hint="Optional. Paste the sentence from the contract so the report can quote it."
            maxLength={2000}
            onChange={(e) => updateTerm(term.id, { snippet: e.target.value })}
          />
        </div>
      ) : (
        <section>
          <h3 className="text-sm font-semibold text-ink">Contract wording</h3>
          <p className="mt-0.5 break-words text-xs text-muted">
            Page {term.pageRef} of {pageCount} in {fileName}
          </p>
          {term.snippet ? (
            <blockquote className="mt-3 rounded-lg border border-line bg-surface-2 p-3 text-sm leading-6 text-ink">
              <HighlightedSnippet text={term.snippet} match={term.match} />
            </blockquote>
          ) : (
            <p className="mt-3 text-sm text-muted">No wording was kept for this term.</p>
          )}
          {term.snippet && term.match ? (
            <p className="mt-2 text-xs text-muted">The marked words are what this term was found by.</p>
          ) : null}
        </section>
      )}

      <section>
        <h3 className="text-sm font-semibold text-ink">What it says</h3>
        <p className="mt-0.5 text-xs text-muted">Correct the value or unit if it was read wrongly.</p>
        <div className="mt-3 grid grid-cols-[2fr_3fr] gap-3">
          <Input label="Value" autoComplete="off" className="num" {...valueField} />
          <Select label="Unit" value={term.unit} onChange={(e) => updateTerm(term.id, { unit: e.target.value })}>
            <UnitOptions current={term.unit} />
          </Select>
        </div>
        <div className="mt-4">
          <ConfirmBox term={term} detail="Use this term to check claims." />
        </div>
      </section>

      {manual ? (
        <section className="border-t border-line pt-5">
          <Button
            ref={removeButton}
            variant="ghost"
            size="sm"
            className="-ml-3"
            icon={<Trash2 className="h-4 w-4" />}
            aria-expanded={confirmingRemove}
            onClick={() => setConfirmingRemove((open) => !open)}
          >
            Remove this term
          </Button>
          {confirmingRemove ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="mr-1 text-sm text-ink">Remove it from this audit?</p>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  removeTerm(term.id);
                  onRemoved();
                }}
              >
                Yes, remove
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setConfirmingRemove(false);
                  removeButton.current?.focus();
                }}
              >
                Keep it
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
