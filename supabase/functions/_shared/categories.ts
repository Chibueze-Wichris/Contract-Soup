/**
 * The vocabulary the AI reader is allowed to use.
 *
 * This file is shared: the Edge Function uses it to build the prompt and the
 * response schema and to reject anything outside it, and the web app uses it
 * for display names. Keep it free of Deno and browser APIs.
 *
 * MONEY_CATEGORIES must stay identical to TERM_CATEGORIES in
 * src/analyzer/categories.ts. The deterministic money checks look terms up by
 * these ids, so the AI reader files terms under them and never under new names.
 * A test fails if the two lists drift apart.
 */

export interface VocabularyEntry {
  id: string;
  /** Name shown to people. */
  label: string;
  /** What belongs here, written for the model. */
  guide: string;
}

/** The 14 financial categories the money checks understand. Same ids and labels as the web app. */
export const MONEY_CATEGORIES = [
  {
    id: "admin_fee",
    label: "Administrative fee (PEPM)",
    guide:
      'The base administrative or service fee the plan pays the administrator, TPA or PBM, usually a dollar amount per employee, member, subscriber or participant per month. value_number is the dollar amount and unit is usually "USD PEPM".',
  },
  {
    id: "rebate_guarantee",
    label: "Rebate guarantee",
    guide:
      'The share or amount of manufacturer rebates that must be passed to the plan. When it is a share, value_number is the percent (90 for 90%, 100 for full pass-through) and unit is "%".',
  },
  {
    id: "spread_pricing",
    label: "Spread pricing / pass-through",
    guide:
      "Whether the vendor may keep a spread between what it charges the plan and what it pays pharmacies or providers, or must price on a pass-through basis.",
  },
  { id: "mac_pricing", label: "MAC pricing", guide: "Maximum allowable cost (MAC) lists and how generic or other drug prices are set." },
  { id: "dispensing_fee", label: "Dispensing fee", guide: 'A fee for each prescription dispensed. unit is usually "USD/claim".' },
  { id: "network_access_fee", label: "Network access fee", guide: "A fee for access to a provider or pharmacy network." },
  {
    id: "stop_loss",
    label: "Stop-loss premium / attachment point",
    guide: "Stop-loss premiums, and specific or aggregate attachment points and deductibles.",
  },
  { id: "minimum_premium", label: "Minimum premium", guide: "Minimum premium or minimum fee commitments." },
  {
    id: "run_in_run_out",
    label: "Run-in / run-out fee",
    guide: "Fees for handling claims incurred before the agreement starts (run-in) or after it ends (run-out).",
  },
  {
    id: "termination_fee",
    label: "Termination fee",
    guide: "Charges that fall due because the agreement ends: early-termination, disengagement, transition or deconversion fees.",
  },
  {
    id: "auto_renewal",
    label: "Auto-renewal",
    guide:
      'Automatic renewal of the agreement and the notice needed to stop it. When a notice period in days is stated, value_number is the number of days and unit is "days".',
  },
  {
    id: "audit_rights",
    label: "Audit-rights limitation",
    guide: "The client's right to audit the vendor and any limit on it: how often, how far back, how much notice, who may audit, who pays.",
  },
  {
    id: "price_adjustment",
    label: "Price-adjustment clause",
    guide:
      'Wording that lets fees or prices change: annual increases, CPI escalators, changes on notice. When a cap or a fixed percent is stated, value_number is that percent and unit is "%".',
  },
  {
    id: "other_fees",
    label: 'Catch-all "other fees" language',
    guide: "Catch-all wording that allows additional, unspecified or discretionary fees and charges.",
  },
] as const satisfies readonly VocabularyEntry[];

/**
 * Kinds of provision that are not one of the 14 money categories. Terms filed here are
 * shown, reviewed and reported, but the money checks never read them.
 */
export const PROVISION_CATEGORIES = [
  {
    id: "payment_terms",
    label: "Payment terms",
    guide: "Invoicing and payment mechanics: due dates, funding of claims accounts, late-payment interest, set-off.",
  },
  {
    id: "performance_guarantee",
    label: "Performance guarantee",
    guide: "Service levels and performance guarantees, with any penalties or fees at risk.",
  },
  {
    id: "obligation",
    label: "Obligation",
    guide: "A duty a party must perform that is not itself a fee: reporting, data delivery, notices, cooperation, staffing, insurance.",
  },
  {
    id: "contract_term",
    label: "Contract term and renewal",
    guide: "How long the agreement runs: effective date, initial term, expiry, and renewal that is not automatic.",
  },
  {
    id: "termination_rights",
    label: "Termination rights",
    guide: "Who may end the agreement, on what grounds and with how much notice. Not the fees for doing so.",
  },
  {
    id: "restriction",
    label: "Restriction",
    guide:
      "A limit on what the client may do: exclusivity, minimum volumes, non-solicitation, limits on changing vendor or plan design, limits on using its own data.",
  },
  {
    id: "exception",
    label: "Exception or carve-out",
    guide: "A carve-out that narrows another provision: excluded drugs, claims, services, fees or guarantees.",
  },
  {
    id: "compliance",
    label: "Compliance requirement",
    guide: "Legal and regulatory commitments: ERISA and fiduciary status, HIPAA, privacy and security law, licensing, disclosure duties.",
  },
  {
    id: "data_confidentiality",
    label: "Data and confidentiality",
    guide: "Confidentiality, ownership of and access to claims data, keeping of records.",
  },
  {
    id: "liability_indemnity",
    label: "Liability and indemnity",
    guide: "Limits of liability, indemnities, disclaimers and caps on damages.",
  },
  {
    id: "dispute_resolution",
    label: "Dispute resolution",
    guide: "Governing law, arbitration, venue, and time limits for disputes or claim adjustments.",
  },
  { id: "other_provision", label: "Other provision", guide: "A material provision that fits none of the other categories." },
] as const satisfies readonly VocabularyEntry[];

export type MoneyCategoryId = (typeof MONEY_CATEGORIES)[number]["id"];
export type ProvisionCategoryId = (typeof PROVISION_CATEGORIES)[number]["id"];
export type AiCategoryId = MoneyCategoryId | ProvisionCategoryId;

export const AI_CATEGORY_IDS: readonly string[] = [...MONEY_CATEGORIES, ...PROVISION_CATEGORIES].map((c) => c.id);

const MONEY_IDS: ReadonlySet<string> = new Set(MONEY_CATEGORIES.map((c) => c.id));

/** True for the 14 categories the money checks read. */
export function isMoneyCategory(id: string): boolean {
  return MONEY_IDS.has(id);
}

/**
 * Units as the model names them. "none" becomes the empty unit. The rest are the exact strings
 * the money checks compare against, plus months and years for durations.
 */
export const UNIT_CHOICES = ["USD PEPM", "USD/claim", "USD/person", "USD/month", "USD/year", "USD", "%", "days", "months", "years", "none"] as const;
export type UnitChoice = (typeof UNIT_CHOICES)[number];

export const NOTICE_UNITS = ["days", "months", "years"] as const;
export type NoticeUnit = (typeof NOTICE_UNITS)[number];

export const LEVELS = ["high", "medium", "low"] as const;
export type Level = (typeof LEVELS)[number];

/** What an AI observation can be about. In saved findings the type is "ai_" followed by the id. */
export const RISK_KINDS = [
  {
    id: "cost_exposure",
    label: "Open-ended cost",
    guide:
      "Wording that can raise what the plan pays without a clear limit: uncapped increases, undefined or discretionary fees, retained spread or rebates, broad pass-through of costs.",
  },
  {
    id: "ambiguity",
    label: "Ambiguous wording",
    guide: "Key wording that is undefined, vague or open to two readings, so an amount or a duty cannot be pinned down.",
  },
  {
    id: "one_sided",
    label: "One-sided term",
    guide: "Rights or remedies that run to the vendor only, or duties that fall on the client only.",
  },
  {
    id: "lifecycle",
    label: "Renewal or termination risk",
    guide: "Automatic renewal, short or early notice windows, termination penalties, fees that survive the end of the agreement.",
  },
  {
    id: "restriction",
    label: "Limit on your rights",
    guide: "Limits on audits, access to data, disputes, or the freedom to change vendor.",
  },
  { id: "conflict", label: "Clauses that conflict", guide: "Two quoted provisions that contradict each other or cannot both apply as written." },
  {
    id: "compliance",
    label: "Compliance point",
    guide: "Wording that bears on fiduciary, disclosure, privacy or other legal duties and that a lawyer should read.",
  },
  { id: "other", label: "Other contract risk", guide: "A risk in the quoted wording that fits none of the other kinds." },
] as const satisfies readonly VocabularyEntry[];

export type RiskKindId = (typeof RISK_KINDS)[number]["id"];
export const RISK_KIND_IDS: readonly string[] = RISK_KINDS.map((k) => k.id);
