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

/** The name to show for a term: its own label, or its category when the label was left empty. */
export function termTitle(term: Pick<ContractTerm, "label" | "category">): string {
  return term.label.trim() || categoryLabel(term.category);
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
