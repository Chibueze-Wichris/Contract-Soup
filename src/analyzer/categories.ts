/** Display data only (no analysis logic), so the UI can import it freely. */
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

export function categoryLabel(id: string): string {
  return TERM_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export const FINDING_TYPE_LABELS: Record<string, string> = {
  duplicate_claims: "Duplicate claims",
  uncontracted_fee: "Fee not in contract",
  admin_fee_over_contract: "Admin fee above contract",
  outlier_charge: "Unusually high charges",
  rebate_shortfall: "Rebate shortfall",
  unexplained_fee_increase: "Fee increase without a clause",
};

export function findingTypeLabel(type: string): string {
  return FINDING_TYPE_LABELS[type] ?? type;
}
