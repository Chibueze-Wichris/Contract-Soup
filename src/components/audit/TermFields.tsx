import { useState } from "react";
import type { ContractTerm } from "@/analyzer";
import { cn } from "@/lib/cn";
import { TERM_UNITS, formatTermValue, parseTermValue, termTitle } from "@/lib/terms";
import { useDraftAuditStore } from "@/store/useDraftAuditStore";

/** Unit choices for a term. A unit that is not on the standard list is kept as an extra choice. */
export function UnitOptions({ current }: { current: string }) {
  const known = TERM_UNITS.some((u) => u.value === current);
  return (
    <>
      {known ? null : <option value={current}>{current}</option>}
      {TERM_UNITS.map((u) => (
        <option key={u.value} value={u.value}>
          {u.label}
        </option>
      ))}
    </>
  );
}

/**
 * Props for a text field that edits a term's value. What is typed is shown as typed while the field
 * has focus and is tidied ("3600" becomes "3,600") when focus leaves. The draft always holds the parsed value.
 */
export function useTermValueField(term: ContractTerm) {
  const updateTerm = useDraftAuditStore((s) => s.updateTerm);
  const [typed, setTyped] = useState<string | null>(null);
  // A unit only makes sense with a number in front of it. Said once typing has stopped, not on every key.
  const needsNumber = typed === null && term.unit !== "" && typeof term.value !== "number";
  return {
    value: typed ?? formatTermValue(term.value),
    error: needsNumber ? "Enter a number, or set the unit to No unit." : undefined,
    onChange: (e: { target: { value: string } }) => {
      setTyped(e.target.value);
      updateTerm(term.id, { value: parseTermValue(e.target.value) });
    },
    onBlur: () => setTyped(null),
  };
}

interface ConfirmBoxProps {
  term: ContractTerm;
  /** Shrink to a bare checkbox once the list is wide enough to have a "Confirmed" column heading. */
  compact?: boolean;
  /** Words after "Confirmed", for places with room to explain what confirming does. */
  detail?: string;
}

/** The "Confirmed" checkbox for a term. Only confirmed terms are used when claims are checked. */
export function ConfirmBox({ term, compact = false, detail }: ConfirmBoxProps) {
  const updateTerm = useDraftAuditStore((s) => s.updateTerm);
  return (
    <label
      className={cn(
        "inline-flex min-h-9 cursor-pointer select-none items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors duration-150",
        term.confirmed
          ? "border-transparent bg-success-soft text-success-ink"
          : "border-line bg-surface text-ink hover:border-line-strong",
        compact && "@[40rem]:w-full @[40rem]:justify-center @[40rem]:border-transparent @[40rem]:bg-transparent @[40rem]:px-0",
      )}
    >
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 cursor-pointer accent-brand"
        checked={term.confirmed}
        onChange={(e) => updateTerm(term.id, { confirmed: e.target.checked })}
      />
      <span className={cn(compact && "@[40rem]:sr-only")}>
        Confirmed
        {detail ? <span className="font-normal">. {detail}</span> : null}
      </span>
      <span className="sr-only">: {termTitle(term)}</span>
    </label>
  );
}
