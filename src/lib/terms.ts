import type { ContractTerm } from "@/analyzer";
import { categoryLabel } from "@/analyzer/categories";

/**
 * Helpers for editing contract terms in the New Audit wizard.
 * The analyzer compares units as exact strings, so the wizard offers a fixed list.
 */

export const TERM_UNITS: readonly { value: string; label: string }[] = [
  { value: "USD PEPM", label: "USD PEPM" },
  { value: "USD/claim", label: "USD / claim" },
  { value: "USD/person", label: "USD / person" },
  { value: "USD/month", label: "USD / month" },
  { value: "USD/year", label: "USD / year" },
  { value: "USD", label: "USD" },
  { value: "%", label: "%" },
  { value: "days", label: "days" },
  { value: "months", label: "months" },
  { value: "years", label: "years" },
  { value: "", label: "No unit" },
];

const USUAL_UNIT: Record<string, string> = {
  admin_fee: "USD PEPM",
  rebate_guarantee: "%",
  dispensing_fee: "USD/claim",
  network_access_fee: "USD/year",
  stop_loss: "USD PEPM",
  minimum_premium: "%",
  run_in_run_out: "USD",
  termination_fee: "USD",
  auto_renewal: "days",
  audit_rights: "days",
  price_adjustment: "%",
};

/** The unit a category usually has, as a starting point when a term is added by hand. */
export function usualUnit(category: string): string {
  return USUAL_UNIT[category] ?? "";
}

/**
 * Turns what was typed into a term value: a number when it reads as one
 * ("$3,600" -> 3600, "90%" -> 90), otherwise the text itself, and null when empty.
 */
export function parseTermValue(text: string): number | string | null {
  const s = text.trim();
  if (!s) return null;
  const cleaned = s
    .replace(/^\$\s*/, "")
    .replace(/\s*%$/, "")
    .replace(/,(?=\d{3}(?:\D|$))/g, "");
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(cleaned) ? Number(cleaned) : s;
}

/** The value as shown in an input: 150000 -> "150,000", null -> "". */
export function formatTermValue(value: ContractTerm["value"]): string {
  if (value === null) return "";
  return typeof value === "number" ? value.toLocaleString("en-US", { maximumFractionDigits: 6 }) : value;
}

/** "24.5 USD PEPM", "90%", "Clause present", or "No value" when nothing was entered. */
export function describeTermValue(term: Pick<ContractTerm, "value" | "unit">): string {
  if (term.value === null) return "No value";
  const value = formatTermValue(term.value);
  if (!term.unit) return value;
  if (term.unit === "%") return `${value}%`;
  return `${value} ${TERM_UNITS.find((u) => u.value === term.unit)?.label ?? term.unit}`;
}

/** The name to show for a term: its own label, or its category when the label was left empty. */
export function termTitle(term: Pick<ContractTerm, "label" | "category">): string {
  return term.label.trim() || categoryLabel(term.category);
}

/** Terms the AI reader found, as opposed to the built-in rules or the user. */
export function isAiTerm(term: Pick<ContractTerm, "origin">): boolean {
  return term.origin === "ai";
}

/** True while a term the AI reader flagged is still waiting for a person to confirm it. */
export function awaitsReview(term: Pick<ContractTerm, "needsReview" | "confirmed">): boolean {
  return term.needsReview === true && !term.confirmed;
}

/** "90 days", "1 year". */
export function describeNoticePeriod(notice: NonNullable<ContractTerm["noticePeriod"]>): string {
  const value = notice.value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${value} ${notice.value === 1 ? notice.unit.replace(/s$/, "") : notice.unit}`;
}

/** "2025-01-01" -> "January 1, 2025". The date is a calendar date, so no time zone is applied. */
export function describeIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/**
 * What the AI reader understood about a term, as short lines for the report and the PDF:
 * its meaning, when it applies, what it leaves out, its dates, its notice period and what it points to.
 * Empty for terms from the built-in reader and for terms typed in by hand.
 */
export function termNotes(term: ContractTerm): string[] {
  const notes: string[] = [];
  if (term.summary) notes.push(term.summary);
  if (term.conditions?.length) notes.push(`Applies when: ${term.conditions.join("; ")}`);
  if (term.exceptions?.length) notes.push(`Does not apply to: ${term.exceptions.join("; ")}`);
  if (term.effectiveDate) notes.push(`Effective ${describeIsoDate(term.effectiveDate)}`);
  if (term.expirationDate) notes.push(`Expires ${describeIsoDate(term.expirationDate)}`);
  if (term.noticePeriod) notes.push(`Notice period: ${describeNoticePeriod(term.noticePeriod)}`);
  if (term.relatedClauses?.length) notes.push(`See also: ${term.relatedClauses.join(", ")}`);
  return notes;
}

const MANUAL_PREFIX = "manual-";

/** Terms the user typed in, as opposed to terms read from the contract. */
export function isManualTerm(term: Pick<ContractTerm, "id">): boolean {
  return term.id.startsWith(MANUAL_PREFIX);
}

/** An id for a term added by hand that no existing term uses. */
export function nextManualTermId(terms: readonly ContractTerm[]): string {
  let n = 1;
  for (const t of terms) {
    const m = /^manual-(\d+)$/.exec(t.id);
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  return `${MANUAL_PREFIX}${n}`;
}
