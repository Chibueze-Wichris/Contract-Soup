import { PROVISION_CATEGORIES as AI_PROVISION_CATEGORIES, RISK_KINDS } from "../../supabase/functions/_shared/categories.ts";

/**
 * Display data only (no analysis logic), so the UI can import it freely.
 *
 * TERM_CATEGORIES are the 14 financial categories. The money checks look terms up by these ids,
 * and they are the only categories a term added by hand can have.
 */
export const TERM_CATEGORIES = [
  { id: "admin_fee", label: "Administrative fee (PEPM)" },
  { id: "rebate_guarantee", label: "Rebate guarantee" },
  { id: "spread_pricing", label: "Spread pricing / pass-through" },
  { id: "mac_pricing", label: "MAC pricing" },
  { id: "dispensing_fee", label: "Dispensing fee" },
  { id: "network_access_fee", label: "Network access fee" },
  { id: "stop_loss", label: "Stop-loss premium / attachment point" },
  { id: "minimum_premium", label: "Minimum premium" },
  { id: "run_in_run_out", label: "Run-in / run-out fee" },
  { id: "termination_fee", label: "Termination fee" },
  { id: "auto_renewal", label: "Auto-renewal" },
  { id: "audit_rights", label: "Audit-rights limitation" },
  { id: "price_adjustment", label: "Price-adjustment clause" },
  { id: "other_fees", label: "Catch-all \"other fees\" language" },
] as const;

export type TermCategoryId = (typeof TERM_CATEGORIES)[number]["id"];

/**
 * Kinds of provision the AI reader can report besides the 14 above: obligations, lifecycle
 * provisions, restrictions and exceptions, compliance and risk provisions. They are shown,
 * reviewed and reported, but the money checks never read them. The list is shared with the
 * Edge Function, which accepts nothing outside it.
 */
export const PROVISION_CATEGORIES: readonly { id: string; label: string }[] = AI_PROVISION_CATEGORIES.map(({ id, label }) => ({ id, label }));

const MONEY_CATEGORY_IDS: ReadonlySet<string> = new Set(TERM_CATEGORIES.map((c) => c.id));

/** True for the 14 categories the money checks read. */
export function isMoneyCategory(id: string): boolean {
  return MONEY_CATEGORY_IDS.has(id);
}

export function categoryLabel(id: string): string {
  return TERM_CATEGORIES.find((c) => c.id === id)?.label ?? PROVISION_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export const FINDING_TYPE_LABELS: Record<string, string> = {
  duplicate_claims: "Duplicate claims",
  uncontracted_fee: "Fee not in contract",
  admin_fee_over_contract: "Admin fee above contract",
  outlier_charge: "Unusually high charges",
  rebate_shortfall: "Rebate shortfall",
  unexplained_fee_increase: "Fee increase without a clause",
};

/** Finding types for observations from the AI reader start with this. */
export const AI_FINDING_PREFIX = "ai_";

/** "cost_exposure" -> "ai_cost_exposure" */
export function aiFindingType(kind: string): string {
  return `${AI_FINDING_PREFIX}${kind}`;
}

for (const kind of RISK_KINDS) FINDING_TYPE_LABELS[aiFindingType(kind.id)] = kind.label;

export function findingTypeLabel(type: string): string {
  return FINDING_TYPE_LABELS[type] ?? type;
}
