import { memo } from "react";
import { FileSearch } from "lucide-react";
import type { ContractTerm } from "@/analyzer";
import { categoryLabel, isMoneyCategory } from "@/analyzer/categories";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { ConfirmBox, UnitOptions, useTermValueField } from "./TermFields";
import { AiBadge, Button, Input, NeedsReviewBadge, Select } from "@/components/ui";
import { cn } from "@/lib/cn";
import { awaitsReview, isAiTerm, termTitle } from "@/lib/terms";
import { useDraftAuditStore } from "@/store/useDraftAuditStore";

/** Column layout shared by the list heading and every row once the list is wide enough (40rem). */
export const TERM_GRID = "@[40rem]:grid @[40rem]:grid-cols-[minmax(0,1fr)_8rem_9rem_6rem_4.5rem] @[40rem]:gap-x-3";

interface TermRowProps {
  term: ContractTerm;
  /** Opens the side panel with the contract wording for this term. */
  onOpen: (id: string) => void;
}

/** One contract term in the review list: name, editable value and unit, a link to its wording, and Confirmed. */
export const TermRow = memo(function TermRow({ term, onOpen }: TermRowProps) {
  const updateTerm = useDraftAuditStore((s) => s.updateTerm);
  const valueField = useTermValueField(term);
  const title = termTitle(term);
  const kind = categoryLabel(term.category);

  return (
    <li className={cn("grid gap-y-3 py-4 @[40rem]:items-center @[40rem]:py-3", TERM_GRID)}>
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-ink">{title}</p>
        {/* The AI reader names a term as the contract does, so its kind is worth showing beside the name. */}
        {isAiTerm(term) && kind !== title ? (
          <p className="mt-0.5 break-words text-xs text-muted">
            {kind}
            {isMoneyCategory(term.category) ? "" : ". Not used by the money checks."}
          </p>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-1">
          <ConfidenceBadge term={term} />
          {isAiTerm(term) ? <AiBadge /> : null}
          {awaitsReview(term) ? <NeedsReviewBadge /> : null}
        </div>
      </div>

      <div className="grid grid-cols-[2fr_3fr] gap-3 @[40rem]:contents">
        <div className="min-w-0">
          <span className="mb-1 block text-xs text-muted @[40rem]:hidden" aria-hidden="true">
            Value
          </span>
          <Input aria-label={`Value for ${title}`} autoComplete="off" className="num" {...valueField} />
        </div>
        <div className="min-w-0">
          <span className="mb-1 block text-xs text-muted @[40rem]:hidden" aria-hidden="true">
            Unit
          </span>
          <Select
            aria-label={`Unit for ${title}`}
            value={term.unit}
            onChange={(e) => updateTerm(term.id, { unit: e.target.value })}
          >
            <UnitOptions current={term.unit} />
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 @[40rem]:contents">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 justify-start @[40rem]:ml-0 @[40rem]:px-2"
          icon={<FileSearch className="h-4 w-4" />}
          onClick={() => onOpen(term.id)}
        >
          <span className="@[40rem]:hidden">Wording, page {term.pageRef}</span>
          <span className="hidden @[40rem]:inline">Page {term.pageRef}</span>
          <span className="sr-only">: contract wording for {title}</span>
        </Button>
        <ConfirmBox term={term} compact />
      </div>
    </li>
  );
});
