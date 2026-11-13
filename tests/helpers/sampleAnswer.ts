/**
 * A stand-in for what Gemini returns for the built-in sample agreement: the JSON the response
 * schema asks for. Most items are sound. A few are wrong on purpose, to show what the checks do
 * with them. Used by the tests and by nothing else.
 */

type Item = Record<string, unknown>;

const provision = (fields: Item): Item => ({
  value_number: null,
  value_text: null,
  unit: "none",
  summary: "",
  conditions: [],
  exceptions: [],
  effective_date: null,
  expiration_date: null,
  notice_value: null,
  notice_unit: "none",
  related_clauses: [],
  related_refs: [],
  confidence: "high",
  needs_review: false,
  review_reason: null,
  ...fields,
});

/** Items whose quotation is really in the sample agreement. */
export const SOUND_PROVISIONS: Item[] = [
  provision({
    ref: "t1",
    page: 4,
    quote: 'Client shall pay Administrator an administrative fee of $24.50 per employee per month ("PEPM"), invoiced monthly on the basis of enrolled employees.',
    category: "admin_fee",
    label: "Administrative Fee",
    value_number: 24.5,
    unit: "USD PEPM",
    summary: "The plan pays $24.50 for each enrolled employee each month.",
    conditions: ["Invoiced monthly on the basis of enrolled employees"],
    related_clauses: ["Section 9.1"],
    related_refs: ["t13"],
  }),
  provision({
    ref: "t2",
    page: 4,
    quote: "Client shall pay a network access fee of $3,600 per Contract Year, invoiced in four equal quarterly installments.",
    category: "network_access_fee",
    label: "Network Access Fee",
    value_number: 3600,
    unit: "USD/year",
    summary: "A flat $3,600 a year for network access, billed quarterly.",
  }),
  provision({
    ref: "t3",
    page: 4,
    quote: "Each invoice is due within thirty (30) days of receipt.",
    category: "payment_terms",
    label: "Payment Terms",
    value_number: 30,
    unit: "days",
    summary: "Invoices must be paid within 30 days.",
    exceptions: ["Amounts disputed in good faith"],
  }),
  provision({
    ref: "t4",
    page: 5,
    quote: "Generic drugs are reimbursed at the lesser of the Administrator's Maximum Allowable Cost (\"MAC\") list price, the pharmacy's usual and customary price, or the amount submitted by the pharmacy.",
    category: "mac_pricing",
    label: "Generic Drugs (MAC)",
    value_text: "Lesser of MAC, usual and customary, or submitted amount",
    summary: "Generic drugs are paid at the lowest of three prices, one of which is the Administrator's own MAC list.",
    confidence: "medium",
  }),
  provision({
    ref: "t5",
    page: 5,
    quote: "Administrator shall not engage in spread pricing, and all pharmacy reimbursement shall be charged to Client at the amount actually paid to the dispensing pharmacy.",
    category: "spread_pricing",
    label: "Pass-Through Pricing",
    value_text: "Pass-through; no spread",
    summary: "The Administrator may not keep a spread on pharmacy claims.",
  }),
  provision({
    ref: "t6",
    page: 5,
    quote: "Client shall pay a dispensing fee of $1.50 per retail brand claim, which Administrator passes to the dispensing pharmacy.",
    category: "dispensing_fee",
    label: "Dispensing Fee",
    value_number: 1.5,
    unit: "USD/claim",
    summary: "A $1.50 fee on each retail brand claim.",
    conditions: ["Retail brand claims only"],
  }),
  provision({
    ref: "t7",
    page: 6,
    quote: "Administrator guarantees that Client shall receive ninety percent (90%) of all Manufacturer Rebates attributable to Plan utilization, without offset for any other amounts owed.",
    category: "rebate_guarantee",
    label: "Rebate Guarantee",
    value_number: 90,
    unit: "%",
    summary: "The plan is guaranteed 90% of manufacturer rebates.",
    related_clauses: ["Section 1.4"],
  }),
  provision({
    ref: "t8",
    page: 7,
    quote: "Administrator shall arrange stop-loss coverage for the Plan with a specific attachment point of $150,000 per Covered Individual per Contract Year.",
    category: "stop_loss",
    label: "Specific attachment point",
    value_number: 150000,
    unit: "USD/person",
    summary: "Stop-loss cover starts once one person's claims pass $150,000 in a contract year.",
  }),
  provision({
    ref: "t9",
    page: 7,
    quote: "The stop-loss premium is $38.40 PEPM and is included in the monthly invoice.",
    category: "stop_loss",
    label: "Stop-loss premium",
    value_number: 38.4,
    unit: "USD PEPM",
    summary: "Stop-loss cover costs $38.40 per employee per month.",
  }),
  provision({
    ref: "t10",
    page: 7,
    quote: "A minimum premium arrangement applies, under which Client funds not less than eighty-five percent (85%) of expected monthly claims.",
    category: "minimum_premium",
    label: "Minimum premium",
    value_number: 85,
    unit: "%",
    summary: "The plan must fund at least 85% of expected monthly claims.",
  }),
  provision({
    ref: "t11",
    page: 8,
    quote: "Administrator shall continue to process Claims incurred before the end date for a period of twelve (12) months, for a run-out fee of $12,000.",
    category: "run_in_run_out",
    label: "Run-out fee",
    value_number: 12000,
    unit: "USD",
    summary: "A $12,000 fee for twelve months of run-out processing.",
    conditions: ["Applies if the Agreement ends"],
  }),
  provision({
    ref: "t12",
    page: 9,
    quote: "Client may audit Administrator's claims payments and rebate records no more than once per Contract Year, limited to a random sample of two hundred (200) claims, upon sixty (60) days' written notice.",
    category: "audit_rights",
    label: "Audit rights",
    value_number: 60,
    unit: "days",
    summary: "One audit a year, of a 200-claim sample, on 60 days' notice.",
    notice_value: 60,
    notice_unit: "days",
    confidence: "medium",
  }),
  provision({
    ref: "t13",
    page: 10,
    quote: "Administrator may adjust the Administrative Fee by no more than three percent (3%) per Contract Year, effective on each renewal date and upon sixty (60) days' prior written notice to Client.",
    category: "price_adjustment",
    label: "Administrative Fee adjustment",
    value_number: 3,
    unit: "%",
    summary: "The administrative fee may rise by up to 3% a year.",
    conditions: ["Effective on a renewal date", "Sixty days' prior written notice"],
    notice_value: 60,
    notice_unit: "days",
    related_refs: ["t1"],
  }),
  provision({
    ref: "t14",
    page: 11,
    quote: "Client shall pay a data transition and disengagement fee of $42,500 upon delivery of Plan records in any format other than Administrator's standard claims extract.",
    category: "termination_fee",
    label: "Data transition and disengagement fee",
    value_number: 42500,
    unit: "USD",
    summary: "A $42,500 charge if the plan asks for its records in any format but the Administrator's own.",
    conditions: ["Plan records are delivered in a format other than the standard claims extract"],
    related_clauses: ["Section 10.2"],
    confidence: "medium",
    needs_review: true,
    review_reason: "The fee sits in a records clause, away from the other fees.",
  }),
  provision({
    ref: "t15",
    page: 12,
    quote: "Client shall also reimburse Administrator for any other fees, taxes or costs reasonably incurred in connection with the Services, as notified to Client from time to time.",
    category: "other_fees",
    label: "Additional Costs",
    value_text: "Open-ended reimbursement",
    summary: "The plan must reimburse other fees and costs the Administrator notifies, with no list and no cap.",
    confidence: "medium",
  }),
  provision({
    ref: "t16",
    page: 3,
    quote: "this Agreement shall automatically renew for successive one-year terms unless either party gives written notice of non-renewal at least ninety (90) days before the end of the then-current term.",
    category: "auto_renewal",
    label: "Automatic renewal",
    value_number: 90,
    unit: "days",
    summary: "The agreement renews for a year at a time unless notice is given 90 days before the term ends.",
    notice_value: 90,
    notice_unit: "days",
  }),
  provision({
    ref: "t18",
    page: 1,
    quote: 'This Agreement is entered into as of January 1, 2025 (the "Effective Date")',
    category: "contract_term",
    label: "Effective Date",
    value_text: "Effective January 1, 2025",
    summary: "The agreement starts on January 1, 2025.",
    effective_date: "2025-01-01",
  }),
  provision({
    ref: "t19",
    page: 11,
    quote: "Either party may end this Agreement if the other party commits a material breach that remains uncured thirty (30) days after written notice.",
    category: "termination_rights",
    label: "Termination for Breach",
    value_text: "Either party, for uncured material breach",
    summary: "Either side may end the agreement for a material breach left uncured for 30 days.",
    notice_value: 30,
    notice_unit: "days",
  }),
];

/** Sound, but the model named the wrong page: the wording is on page 3, not page 2. */
export const WRONG_PAGE_PROVISION: Item = provision({
  ref: "t17",
  page: 2,
  quote: "This Agreement begins on the Effective Date and continues for three (3) Contract Years.",
  category: "contract_term",
  label: "Initial Term",
  value_number: 3,
  unit: "years",
  summary: "The first term is three contract years.",
});

/** Real wording, but the figure given (25) is not the one in it (20). */
export const WRONG_FIGURE_PROVISION: Item = provision({
  ref: "t23",
  page: 9,
  quote: "Administrator shall deliver monthly claims and utilization reports within twenty (20) days after the end of each month.",
  category: "obligation",
  label: "Monthly reports",
  value_number: 25,
  unit: "days",
  summary: "Monthly reports are due after the month ends.",
});

/** Items that must be left out. The property name says why. */
export const UNSOUND_PROVISIONS: Record<string, Item> = {
  quote_not_found: provision({
    ref: "t21",
    page: 4,
    quote: "Client shall pay Administrator an implementation fee of $50,000 upon signing of this Agreement.",
    category: "other_fees",
    label: "Implementation fee",
    value_number: 50000,
    unit: "USD",
  }),
  unknown_category: provision({
    ref: "t22",
    page: 4,
    quote: "Client shall pay a network access fee of $3,600 per Contract Year, invoiced in four equal quarterly installments.",
    category: "implementation_fee",
    label: "Made-up category",
    value_number: 3600,
    unit: "USD/year",
  }),
  page_not_in_request: provision({
    ref: "t24",
    page: 40,
    quote: "Client shall pay a network access fee of $3,600 per Contract Year, invoiced in four equal quarterly installments.",
    category: "network_access_fee",
    label: "Page that does not exist",
    value_number: 3600,
    unit: "USD/year",
  }),
};

const risk = (fields: Item): Item => ({ related_refs: [], confidence: "high", needs_review: false, ...fields });

export const SOUND_RISKS: Item[] = [
  risk({
    kind: "cost_exposure",
    severity: "high",
    title: "Open-ended reimbursement of other fees and costs",
    explanation:
      "The plan must reimburse any other fees, taxes or costs the Administrator says it incurred, as notified from time to time. Nothing lists these charges or caps them, so new charges can be added without the contract changing.",
    evidence: [
      {
        page: 12,
        quote: "Client shall also reimburse Administrator for any other fees, taxes or costs reasonably incurred in connection with the Services, as notified to Client from time to time.",
      },
    ],
    related_refs: ["t15"],
  }),
  risk({
    kind: "lifecycle",
    severity: "medium",
    title: "A fee for getting your own records back in a usable format",
    explanation:
      "Leaving the Administrator triggers a $42,500 charge unless the plan accepts its records in the Administrator's own extract format. The charge sits in a records clause rather than with the other fees.",
    evidence: [
      {
        page: 11,
        quote: "Client shall pay a data transition and disengagement fee of $42,500 upon delivery of Plan records in any format other than Administrator's standard claims extract.",
      },
    ],
    related_refs: ["t14"],
    confidence: "medium",
  }),
  risk({
    kind: "restriction",
    severity: "medium",
    title: "Audits are limited to one small sample a year, at the plan's cost",
    explanation:
      "The plan may audit only once a contract year, only a random sample of 200 claims, and only on 60 days' notice. The plan also pays the Administrator's costs of supporting any review.",
    evidence: [
      {
        page: 9,
        quote: "Client may audit Administrator's claims payments and rebate records no more than once per Contract Year, limited to a random sample of two hundred (200) claims",
      },
      { page: 9, quote: "Administrator's reasonable costs of supporting any review shall be borne by Client." },
    ],
    related_refs: ["t12"],
  }),
  risk({
    kind: "ambiguity",
    severity: "low",
    title: "It is unclear what happens to a rejected fee change after the term ends",
    explanation:
      "The plan can reject a fee change, and the old rate then runs to the end of the current term. The wording does not say what rate applies after that.",
    evidence: [{ page: 10, quote: "in which case the existing rate continues until the end of the then-current term" }],
    related_refs: ["t13"],
    confidence: "low",
    needs_review: true,
  }),
];

/** An observation with nothing real behind it. It must be left out. */
export const UNSOUND_RISK: Item = risk({
  kind: "one_sided",
  severity: "high",
  title: "The Administrator may change any fee at will",
  explanation: "The contract lets the Administrator set any fee it likes at any time.",
  evidence: [{ page: 10, quote: "Administrator may change any fee at its sole discretion at any time without notice to Client." }],
});

/** The whole answer, good and bad together, as the model would return it. */
export function sampleModelAnswer(): { provisions: Item[]; risks: Item[] } {
  return {
    provisions: [...SOUND_PROVISIONS, WRONG_PAGE_PROVISION, WRONG_FIGURE_PROVISION, ...Object.values(UNSOUND_PROVISIONS)],
    risks: [...SOUND_RISKS, UNSOUND_RISK],
  };
}

/** The answer restricted to items that quote the given pages, as the model would answer for one batch. */
export function sampleModelAnswerFor(pageNumbers: readonly number[]): { provisions: Item[]; risks: Item[] } {
  const all = sampleModelAnswer();
  const onPages = (page: unknown): boolean => typeof page === "number" && pageNumbers.includes(page);
  return {
    provisions: all.provisions.filter((p) => onPages(p.page)),
    risks: all.risks.filter((r) => (r.evidence as { page: number }[]).every((e) => onPages(e.page))),
  };
}
