import type { ClaimRow, PageText } from "../analyzer/types";

/** Fictional parties and numbers. Any resemblance to a real contract is coincidental. */
export const SAMPLE_FILE_NAME = "Harborview-PBM-Agreement-SAMPLE.pdf";

export const SAMPLE_PAGES: PageText[] = [
  {
    page: 1,
    text: `PHARMACY BENEFIT AND ADMINISTRATIVE SERVICES AGREEMENT
This Agreement is entered into as of January 1, 2025 (the “Effective Date”) by and between Northwind Health Partners, LLC, a Delaware limited liability company (“Administrator”), and Harborview Manufacturing Group, Inc., a Michigan corporation (“Client”), on behalf of the Harborview Manufacturing Group Employee Health Plan (the “Plan”).
RECITALS
A. Client sponsors a self-funded group health plan for its eligible employees and their dependents.
B. Administrator provides claims processing, pharmacy benefit management, network management and related services.
C. Client wishes to engage Administrator, and Administrator wishes to be engaged, on the terms set out in this Agreement and its Schedules.
NOW, THEREFORE, in consideration of the mutual promises below, the parties agree as follows.`,
  },
  {
    page: 2,
    text: `ARTICLE 1. DEFINITIONS
1.1 “Claim” means a request for payment of a benefit under the Plan, submitted by or for a Covered Individual.
1.2 “Contract Year” means each consecutive twelve-month period beginning on the Effective Date or an anniversary of it.
1.3 “Covered Individual” means an employee or dependent enrolled in the Plan.
1.4 “Manufacturer Rebates” means all rebates, discounts, price concessions and other payments received by Administrator or its affiliates from pharmaceutical manufacturers that are attributable to Plan utilization.
1.5 “Services” means the claims administration, pharmacy benefit management, reporting and related services described in the Schedules.
1.6 “Schedules” means Schedules A through C attached to this Agreement, which form part of it.`,
  },
  {
    page: 3,
    text: `ARTICLE 2. TERM AND RENEWAL
2.1 Initial Term. This Agreement begins on the Effective Date and continues for three (3) Contract Years.
2.2 Renewal. After the initial term, this Agreement shall automatically renew for successive one-year terms unless either party gives written notice of non-renewal at least ninety (90) days before the end of the then-current term.
2.3 Notice. Any notice under this Article must be in writing and sent by certified mail or recognized overnight courier to the address on the signature page.
2.4 Continuity. During any notice period, Administrator shall continue to perform the Services in the ordinary course.`,
  },
  {
    page: 4,
    text: `ARTICLE 3. FEES AND PAYMENT
3.1 Administrative Fee. In consideration of the Services, Client shall pay Administrator an administrative fee of $24.50 per employee per month (“PEPM”), invoiced monthly on the basis of enrolled employees.
3.2 Network Access Fee. Client shall pay a network access fee of $3,600 per Contract Year, invoiced in four equal quarterly installments.
3.3 Payment Terms. Each invoice is due within thirty (30) days of receipt. Undisputed amounts not paid when due accrue interest at the rate permitted by law.
3.4 Disputed Invoices. Client may dispute an invoice in good faith by written notice and shall pay the undisputed portion on time.`,
  },
  {
    page: 5,
    text: `ARTICLE 4. PHARMACY PRICING
4.1 Brand Drugs. Brand prescription drugs dispensed at retail pharmacies are reimbursed at the pharmacy’s contracted rate for that drug.
4.2 Generic Drugs. Generic drugs are reimbursed at the lesser of the Administrator’s Maximum Allowable Cost (“MAC”) list price, the pharmacy’s usual and customary price, or the amount submitted by the pharmacy.
4.3 Pass-Through Pricing. Administrator shall not engage in spread pricing, and all pharmacy reimbursement shall be charged to Client at the amount actually paid to the dispensing pharmacy.
4.4 Dispensing Fee. Client shall pay a dispensing fee of $1.50 per retail brand claim, which Administrator passes to the dispensing pharmacy.`,
  },
  {
    page: 6,
    text: `ARTICLE 5. MANUFACTURER REBATES
5.1 Rebate Guarantee. Administrator guarantees that Client shall receive ninety percent (90%) of all Manufacturer Rebates attributable to Plan utilization, without offset for any other amounts owed.
5.2 Payment. Rebates shall be remitted to Client within ninety (90) days following the end of each calendar quarter, together with a written reconciliation.
5.3 Reporting. Administrator shall deliver a quarterly report listing each manufacturer, the drugs involved and the amounts received.`,
  },
  {
    page: 7,
    text: `ARTICLE 6. STOP-LOSS AND FUNDING
6.1 Stop-Loss Coverage. Administrator shall arrange stop-loss coverage for the Plan with a specific attachment point of $150,000 per Covered Individual per Contract Year.
6.2 Premium. The stop-loss premium is $38.40 PEPM and is included in the monthly invoice.
6.3 Funding Method. A minimum premium arrangement applies, under which Client funds not less than eighty-five percent (85%) of expected monthly claims.
6.4 Settlement. Any difference between expected and actual claims is reconciled annually within one hundred twenty (120) days after the Contract Year ends.`,
  },
  {
    page: 8,
    text: `ARTICLE 7. CLAIMS RUNOUT
7.1 Run-Out Period. If this Agreement ends, Administrator shall continue to process Claims incurred before the end date for a period of twelve (12) months, for a run-out fee of $12,000.
7.2 Claims Standards. Administrator shall process clean claims within thirty (30) days of receipt and shall follow the Plan document when deciding eligibility and benefits.
7.3 Appeals. Administrator shall handle first-level member appeals and shall refer second-level appeals to Client.`,
  },
  {
    page: 9,
    text: `ARTICLE 8. REPORTING AND AUDIT
8.1 Reports. Administrator shall deliver monthly claims and utilization reports within twenty (20) days after the end of each month.
8.2 Audit. Client may audit Administrator’s claims payments and rebate records no more than once per Contract Year, limited to a random sample of two hundred (200) claims, upon sixty (60) days’ written notice.
8.3 Cooperation. Administrator shall make reasonable personnel available during normal business hours. Administrator’s reasonable costs of supporting any review shall be borne by Client.`,
  },
  {
    page: 10,
    text: `ARTICLE 9. CHANGES TO FEES
9.1 Administrator may adjust the Administrative Fee by no more than three percent (3%) per Contract Year, effective on each renewal date and upon sixty (60) days’ prior written notice to Client.
9.2 Client may reject a proposed change by giving written notice within thirty (30) days, in which case the existing rate continues until the end of the then-current term.`,
  },
  {
    page: 11,
    text: `ARTICLE 10. TERMINATION AND RECORDS
10.1 Termination for Breach. Either party may end this Agreement if the other party commits a material breach that remains uncured thirty (30) days after written notice.
10.2 Return of Data. Upon expiration or termination for any reason, Administrator shall return or destroy Client’s Plan data within sixty (60) days, subject to Section 10.3.
10.3 Delivery Format. Client shall pay a data transition and disengagement fee of $42,500 upon delivery of Plan records in any format other than Administrator’s standard claims extract.
10.4 Survival. Articles 5, 8 and this Article survive expiration or termination.`,
  },
  {
    page: 12,
    text: `ARTICLE 11. GENERAL
11.1 Governing Law. This Agreement is governed by the laws of the State of Michigan, without regard to its conflict-of-laws rules.
11.2 Additional Costs. Client shall also reimburse Administrator for any other fees, taxes or costs reasonably incurred in connection with the Services, as notified to Client from time to time.
11.3 Entire Agreement. This Agreement and its Schedules are the entire agreement of the parties on this subject and replace all earlier discussions.
IN WITNESS WHEREOF, the parties have signed this Agreement as of the Effective Date.
Northwind Health Partners, LLC  By: Dana Whitfield, Vice President, Contracts
Harborview Manufacturing Group, Inc.  By: Priya Raman, Chief Financial Officer`,
  },
];

// ---- Planted problems -------------------------------------------------------------------------

export interface PlantedProblem {
  id: string;
  title: string;
  description: string;
  /** Whether the problem should show up as a contract term or as a finding. */
  detectedBy: "terms" | "findings";
  expect: {
    findingType?: string;
    termCategory?: string;
    page?: number;
    value?: number | string;
    /** The finding must reference all of these claim IDs. */
    claimIds?: string[];
    /** The finding must mention this fee name. */
    feeType?: string;
  };
}

/** Contract terms that are correct and expected to be extracted. Used to check extraction accuracy. */
export const EXPECTED_TERMS: { category: string; page: number; value: number | string }[] = [
  { category: "auto_renewal", page: 3, value: 90 },
  { category: "admin_fee", page: 4, value: 24.5 },
  { category: "network_access_fee", page: 4, value: 3600 },
  { category: "mac_pricing", page: 5, value: "Clause present" },
  { category: "spread_pricing", page: 5, value: "Clause present" },
  { category: "dispensing_fee", page: 5, value: 1.5 },
  { category: "rebate_guarantee", page: 6, value: 90 },
  { category: "stop_loss", page: 7, value: 150000 },
  { category: "stop_loss", page: 7, value: 38.4 },
  { category: "minimum_premium", page: 7, value: 85 },
  { category: "run_in_run_out", page: 8, value: 12000 },
  { category: "audit_rights", page: 9, value: 60 },
  { category: "price_adjustment", page: 10, value: 3 },
];

// ---- Claims generator -------------------------------------------------------------------------

const PROVIDER = "Northwind Health Partners";
const MEMBERS = Array.from({ length: 12 }, (_, i) => `M-${1001 + i}`);

/** Small seeded generator so the sample is identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (n: number): number => Math.round(n * 100) / 100;
const pad = (n: number): string => String(n).padStart(2, "0");

interface Draft extends Omit<ClaimRow, "claimId"> {
  tag?: string;
}

const CATEGORIES: { name: string; count: number; mean: number; providers: string[] }[] = [
  { name: "Medical", count: 34, mean: 420, providers: ["Lakeshore Family Medicine", "Riverside Urgent Care", "Summit Orthopedics"] },
  { name: "Pharmacy", count: 34, mean: 95, providers: ["Corner Drug", "Meridian Pharmacy", "Pine Street Pharmacy"] },
  { name: "Lab", count: 22, mean: 60, providers: ["Clearview Labs", "Metro Diagnostics"] },
  { name: "Imaging", count: 18, mean: 640, providers: ["Valley Imaging Center", "St. Anne Radiology"] },
  { name: "Specialty Rx", count: 16, mean: 4800, providers: ["Apex Specialty Pharmacy"] },
];

/** Indices into the base claims list (before sorting). */
const DUPLICATE_INDEXES = [3, 41, 58, 77, 90, 112];
const OUTLIER_INDEXES: { index: number; multiplier: number }[] = [
  { index: 12, multiplier: 9 }, // Medical
  { index: 50, multiplier: 14 }, // Pharmacy
  { index: 75, multiplier: 12 }, // Lab
  { index: 98, multiplier: 8 }, // Imaging
];

interface SampleBuild {
  claims: ClaimRow[];
  duplicateGroups: string[][];
  outlierIds: string[];
  rebateIds: string[];
  clinicalIds: string[];
  networkIds: string[];
}

function buildSample(): SampleBuild {
  const rnd = mulberry32(20250101);
  const drafts: Draft[] = [];

  // Everyday claims.
  const base: Draft[] = [];
  for (const cat of CATEGORIES) {
    for (let i = 0; i < cat.count; i++) {
      const billed = r2(cat.mean * (0.6 + rnd() * 0.8));
      base.push({
        date: `2025-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}`,
        provider: cat.providers[Math.floor(rnd() * cat.providers.length)],
        category: cat.name,
        billed,
        paid: r2(billed * (0.7 + rnd() * 0.15)),
        member: MEMBERS[Math.floor(rnd() * MEMBERS.length)],
      });
    }
  }
  // Planted: unusually large charges.
  for (const { index, multiplier } of OUTLIER_INDEXES) {
    const c = base[index];
    c.billed = r2(c.billed * multiplier);
    c.paid = r2(c.billed * 0.8);
    c.tag = "outlier";
  }
  drafts.push(...base);
  // Planted: the same claim paid twice.
  DUPLICATE_INDEXES.forEach((index, n) => {
    base[index].tag = `dup-${n}-a`;
    drafts.push({ ...base[index], tag: `dup-${n}-b` });
  });

  // Administrative fee per member per month. Contract says $24.50; from July it is billed at $29.75.
  for (let month = 1; month <= 12; month++) {
    const rate = month >= 7 ? 29.75 : 24.5;
    for (const member of MEMBERS) {
      drafts.push({
        date: `2025-${pad(month)}-01`,
        provider: PROVIDER,
        category: "Fees",
        feeType: "Administrative Fee",
        billed: rate,
        paid: rate,
        member,
      });
    }
  }
  // Network access fee, quarterly. Contract: $3,600 per year ($900 a quarter). It rises in Q3 with no clause.
  [
    ["2025-03-31", 900],
    ["2025-06-30", 900],
    ["2025-09-30", 1050],
    ["2025-12-31", 1050],
  ].forEach(([date, amount]) => {
    drafts.push({
      date: date as string,
      provider: PROVIDER,
      category: "Fees",
      feeType: "Network Access Fee",
      billed: amount as number,
      paid: amount as number,
      tag: "network",
    });
  });
  // Dispensing fee, a fixed $1.50 each month as in the contract.
  for (let month = 1; month <= 12; month++) {
    drafts.push({ date: `2025-${pad(month)}-15`, provider: PROVIDER, category: "Fees", feeType: "Dispensing Fee", billed: 1.5, paid: 1.5 });
  }
  // Planted: a fee type that is not in the contract at all.
  for (let month = 7; month <= 12; month++) {
    drafts.push({
      date: `2025-${pad(month)}-10`,
      provider: PROVIDER,
      category: "Fees",
      feeType: "Clinical Program Fee",
      billed: 850,
      paid: 850,
      tag: "clinical",
    });
  }
  // Planted: rebates. `billed` is what manufacturers paid out, `paid` is what reached the plan (guarantee is 90%).
  [
    ["2025-03-31", 21400, 15400],
    ["2025-06-30", 19850, 14300],
    ["2025-09-30", 23100, 16600],
    ["2025-12-31", 22650, 16300],
  ].forEach(([date, billed, paid]) => {
    drafts.push({ date: date as string, provider: PROVIDER, category: "Rebate", billed: billed as number, paid: paid as number, tag: "rebate" });
  });

  // Stable order by date, then assign IDs.
  const ordered = drafts
    .map((d, i) => ({ d, i }))
    .sort((a, b) => a.d.date.localeCompare(b.d.date) || a.i - b.i)
    .map(({ d }, n) => ({ ...d, claimId: `C-${String(n + 1).padStart(5, "0")}` }));

  const idsByTag = (test: (tag: string) => boolean): string[] =>
    ordered.filter((c) => c.tag !== undefined && test(c.tag)).map((c) => c.claimId);
  const duplicateGroups = DUPLICATE_INDEXES.map((_, n) => idsByTag((t) => t.startsWith(`dup-${n}-`)));

  const claims: ClaimRow[] = ordered.map(({ tag: _tag, ...row }) => row);
  return {
    claims,
    duplicateGroups,
    outlierIds: idsByTag((t) => t === "outlier"),
    rebateIds: idsByTag((t) => t === "rebate"),
    clinicalIds: idsByTag((t) => t === "clinical"),
    networkIds: idsByTag((t) => t === "network"),
  };
}

const BUILT = buildSample();

/** About 300 claim rows with planted duplicates and outliers. Identical on every call. */
export function generateSampleClaims(): ClaimRow[] {
  return BUILT.claims.map((c) => ({ ...c }));
}

export const PLANTED: PlantedProblem[] = [
  {
    id: "admin-fee-over-contract",
    title: "Administrative fee billed above the contract rate",
    description: "Contract (page 4): $24.50 PEPM. Claims show $29.75 PEPM from July to December 2025.",
    detectedBy: "findings",
    expect: { findingType: "admin_fee_over_contract" },
  },
  {
    id: "rebate-guarantee-missed",
    title: "Rebate guarantee missed",
    description: "Contract (page 6) guarantees 90% of rebates. Only about 72% of rebates collected were passed through.",
    detectedBy: "findings",
    expect: { findingType: "rebate_shortfall", claimIds: BUILT.rebateIds },
  },
  {
    id: "uncontracted-fee-type",
    title: "Fee type that is not in the contract",
    description: "\"Clinical Program Fee\" is billed monthly from July. No contract term mentions it.",
    detectedBy: "findings",
    expect: { findingType: "uncontracted_fee", feeType: "Clinical Program Fee", claimIds: BUILT.clinicalIds },
  },
  {
    id: "hidden-termination-fee",
    title: "Hidden termination fee",
    description: "Page 11, section 10.3: a $42,500 \"data transition and disengagement fee\" buried in the records clause.",
    detectedBy: "terms",
    expect: { termCategory: "termination_fee", page: 11, value: 42500 },
  },
  {
    id: "catch-all-other-fees",
    title: "Catch-all \"other fees\" clause",
    description: "Page 12, section 11.2: Client reimburses \"any other fees, taxes or costs\" as notified from time to time.",
    detectedBy: "terms",
    expect: { termCategory: "other_fees", page: 12 },
  },
  {
    id: "duplicate-claims",
    title: "Duplicate claims",
    description: `${BUILT.duplicateGroups.length} claims were paid twice (same member, provider, date and amount).`,
    detectedBy: "findings",
    expect: { findingType: "duplicate_claims", claimIds: BUILT.duplicateGroups.flat() },
  },
  {
    id: "outlier-charges",
    title: "Outlier charges",
    description: `${BUILT.outlierIds.length} claims are 8 to 14 times the usual amount for their category.`,
    detectedBy: "findings",
    expect: { findingType: "outlier_charge", claimIds: BUILT.outlierIds },
  },
  {
    id: "fee-increase-no-clause",
    title: "Network access fee increased with no clause",
    description: "The quarterly network access fee rises from $900 to $1,050 in Q3. The only price-adjustment clause (page 10) covers the administrative fee.",
    detectedBy: "findings",
    expect: { findingType: "unexplained_fee_increase", feeType: "Network Access Fee" },
  },
];
