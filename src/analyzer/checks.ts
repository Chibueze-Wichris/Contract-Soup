import type { TermCategoryId } from "./categories";
import { round2 } from "./summary";
import type { ClaimRow, ContractTerm, Finding, Settings, Severity } from "./types";

/**
 * The six claim checks. Everything here is pure arithmetic over the inputs:
 * no network, no LLM, no randomness. Each finding carries a `calc` string that
 * shows the math. Claim-based evidence uses page 0 and claim IDs only; member
 * identifiers are used for grouping but never written into a finding.
 */

const usd = (n: number): string => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const pct = (n: number): string => `${round2(n)}%`;
const key = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const MAX_CALC_LINES = 12;

/** Which fee names in a claims file belong to which contract term category. */
const FEE_ALIASES: Partial<Record<TermCategoryId, RegExp>> = {
  admin_fee: /\badmin|\btpa\b/i,
  network_access_fee: /\bnetwork\b|\baccess\b/i,
  dispensing_fee: /dispens/i,
  stop_loss: /stop.?loss|attachment/i,
  minimum_premium: /minimum premium/i,
  run_in_run_out: /run.?(?:in|out)/i,
  termination_fee: /terminat|disengage|transition/i,
};

interface Period {
  month: string;
  quarter: string;
}

function periodOf(date: string): Period | null {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { month: `${m[1]}-${m[2]}`, quarter: `${m[1]}-Q${Math.ceil(month / 3)}` };
}

function severityFromImpact(impact: number): Severity {
  if (impact >= 10_000) return "high";
  if (impact >= 2_500) return "medium";
  return "low";
}

function atLeast(current: Severity, floor: Severity): Severity {
  return SEVERITY_RANK[current] >= SEVERITY_RANK[floor] ? current : floor;
}

function ids(list: string[], max = 10): string {
  return list.length <= max ? list.join(", ") : `${list.slice(0, max).join(", ")} (+${list.length - max} more)`;
}

function capLines(lines: string[], max = MAX_CALC_LINES): string[] {
  return lines.length <= max ? lines : [...lines.slice(0, max), `… and ${lines.length - max} more`];
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

const contractEvidence = (t: ContractTerm) => ({ page: t.pageRef, snippet: t.snippet });
const claimsEvidence = (snippet: string) => ({ page: 0, snippet });
const isFeeRow = (c: ClaimRow): boolean => Boolean(c.feeType && c.feeType.trim());
const isRebateRow = (c: ClaimRow): boolean => /rebate/i.test(c.category) || /rebate/i.test(c.feeType ?? "");

function open(f: Omit<Finding, "status">): Finding {
  return { ...f, status: "open" };
}

// (a) Duplicate claims: same member, provider, date and amount ------------------------------------

function checkDuplicates(claims: ClaimRow[]): Finding[] {
  const groups = new Map<string, ClaimRow[]>();
  for (const c of claims) {
    const k = [c.member ?? "", key(c.provider), c.date, c.billed.toFixed(2)].join("|");
    const list = groups.get(k);
    if (list) list.push(c);
    else groups.set(k, [c]);
  }
  const dupes = [...groups.values()].filter((g) => g.length > 1);
  if (dupes.length === 0) return [];

  const lines: string[] = [];
  const evidence = [] as Finding["evidence"];
  let impact = 0;
  let extraClaims = 0;
  for (const g of dupes) {
    const extras = g.length - 1;
    const excess = round2(extras * g[0].paid);
    impact += excess;
    extraClaims += extras;
    const claimIds = g.map((c) => c.claimId);
    lines.push(
      `${claimIds.join(" + ")}: same provider (${g[0].provider}), date ${g[0].date}, billed ${usd(g[0].billed)}. ` +
        `${extras} extra × ${usd(g[0].paid)} paid = ${usd(excess)}`,
    );
    evidence.push(
      claimsEvidence(`Claims ${claimIds.join(", ")} · ${g[0].provider} · ${g[0].date} · ${usd(g[0].billed)} billed each`),
    );
  }
  impact = round2(impact);

  return [
    open({
      id: "f-duplicate-claims",
      severity: dupes.length >= 3 ? atLeast(severityFromImpact(impact), "medium") : severityFromImpact(impact),
      type: "duplicate_claims",
      title: `${dupes.length} possible duplicate claim${dupes.length === 1 ? "" : "s"} paid more than once`,
      explanation:
        `${extraClaims} claim${extraClaims === 1 ? " was" : "s were"} paid again for the same member, provider, date and amount. ` +
        `Ask the administrator to confirm each pair and recover any payment made in error.`,
      estimatedImpactUSD: impact,
      evidence,
      calc: [
        "Match rule: same member + provider + date of service + billed amount.",
        ...capLines(lines),
        `Total: ${usd(impact)} (paid amount of each repeated claim, first claim not counted)`,
      ].join("\n"),
    }),
  ];
}

// (b) Fee types in claims that no confirmed term covers --------------------------------------------

function isCovered(feeType: string, confirmed: ContractTerm[]): boolean {
  const name = key(feeType);
  return confirmed.some((t) => {
    if (FEE_ALIASES[t.category as TermCategoryId]?.test(feeType)) return true;
    // A term the user added by hand for this exact fee also covers it.
    return key(t.label).includes(name) || key(t.snippet).includes(name);
  });
}

function checkUncontractedFees(
  claims: ClaimRow[],
  confirmed: ContractTerm[],
): { findings: Finding[]; flagged: Set<string> } {
  const byFee = new Map<string, { name: string; rows: ClaimRow[] }>();
  for (const c of claims) {
    if (!isFeeRow(c)) continue;
    const k = key(c.feeType as string);
    const entry = byFee.get(k);
    if (entry) entry.rows.push(c);
    else byFee.set(k, { name: (c.feeType as string).trim(), rows: [c] });
  }

  const catchAll = confirmed.filter((t) => t.category === "other_fees");
  const findings: Finding[] = [];
  const flagged = new Set<string>();

  for (const [k, { name, rows }] of byFee) {
    if (isCovered(name, confirmed)) continue;
    flagged.add(k);
    const impact = round2(sum(rows.map((r) => r.paid)));
    const dates = rows.map((r) => r.date).sort();
    const claimIds = rows.map((r) => r.claimId);
    const catchAllNote = catchAll.length
      ? ` Your contract has a broad "other fees" clause (page ${catchAll[0].pageRef}) that the vendor may rely on, so ask your legal team whether it really covers this charge.`
      : "";

    findings.push(
      open({
        id: `f-uncontracted-${k.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        severity: severityFromImpact(impact),
        type: "uncontracted_fee",
        title: `"${name}" is billed but not listed in your contract terms`,
        explanation:
          `${rows.length} charge${rows.length === 1 ? "" : "s"} labelled "${name}" ${rows.length === 1 ? "was" : "were"} paid, ` +
          `but none of your confirmed contract terms mentions this fee.${catchAllNote}`,
        estimatedImpactUSD: impact,
        evidence: [
          claimsEvidence(`${rows.length} "${name}" charges, ${dates[0]} to ${dates[dates.length - 1]}. Claims: ${ids(claimIds)}`),
          ...catchAll.map(contractEvidence),
        ],
        calc: `${rows.length} charges paid under "${name}" = ${usd(impact)}\nClaims: ${ids(claimIds)}`,
      }),
    );
  }
  return { findings, flagged };
}

// (c) Administrative fee billed vs the contract PEPM ----------------------------------------------

function checkAdminFee(claims: ClaimRow[], confirmed: ContractTerm[], s: Settings): Finding | null {
  const term = confirmed
    .filter((t) => t.category === "admin_fee" && typeof t.value === "number" && t.unit.startsWith("USD"))
    .sort((a, b) => Number(b.unit.includes("PEPM")) - Number(a.unit.includes("PEPM")) || a.pageRef - b.pageRef)[0];
  if (!term) return null;
  const contractRate = term.value as number;
  const limit = contractRate * (1 + s.feeTolerancePct / 100);

  // Each admin-fee row is one member's charge for one month. Rows without a member are skipped
  // because a rate per member cannot be worked out from them.
  const months = new Map<string, { billed: number; members: Set<string> }>();
  for (const c of claims) {
    if (!isFeeRow(c) || !c.member || !FEE_ALIASES.admin_fee?.test(c.feeType as string)) continue;
    const p = periodOf(c.date);
    if (!p) continue;
    const entry = months.get(p.month) ?? { billed: 0, members: new Set<string>() };
    entry.billed += c.billed;
    entry.members.add(c.member);
    months.set(p.month, entry);
  }
  if (months.size === 0) return null;

  const lines: string[] = [];
  let impact = 0;
  let billedInFlagged = 0;
  let unitsInFlagged = 0;
  let flaggedCount = 0;
  for (const month of [...months.keys()].sort()) {
    const { billed, members } = months.get(month) as { billed: number; members: Set<string> };
    const units = members.size;
    const rate = billed / units;
    if (rate <= limit + 1e-9) continue;
    const over = round2(billed - contractRate * units);
    impact += over;
    billedInFlagged += billed;
    unitsInFlagged += units;
    flaggedCount += 1;
    lines.push(
      `${month}: ${usd(billed)} billed ÷ ${units} member-months = ${usd(rate)} PEPM. ` +
        `Over by ${usd(billed)} − (${usd(contractRate)} × ${units}) = ${usd(over)}`,
    );
  }
  if (flaggedCount === 0) return null;
  impact = round2(impact);
  const avgRate = billedInFlagged / unitsInFlagged;
  const flaggedMonths = [...months.keys()].sort().filter((m) => {
    const e = months.get(m) as { billed: number; members: Set<string> };
    return e.billed / e.members.size > limit + 1e-9;
  });

  return open({
    id: "f-admin-fee-over-contract",
    severity: flaggedCount >= 3 ? atLeast(severityFromImpact(impact), "medium") : severityFromImpact(impact),
    type: "admin_fee_over_contract",
    title: `Administrative fee billed above the contract rate in ${flaggedCount} of ${months.size} months`,
    explanation:
      `Your contract sets the administrative fee at ${usd(contractRate)} per employee per month. ` +
      `In ${flaggedCount} month${flaggedCount === 1 ? "" : "s"} the claims show an average of ${usd(avgRate)}, ` +
      `above the ${pct(s.feeTolerancePct)} tolerance. Ask for credit of the difference.`,
    estimatedImpactUSD: impact,
    evidence: [
      contractEvidence(term),
      claimsEvidence(`Administrative fee charges above ${usd(limit)} PEPM in: ${flaggedMonths.join(", ")}`),
    ],
    calc: [
      `Contract rate: ${usd(contractRate)} PEPM (page ${term.pageRef}). Allowed up to ${usd(limit)} with a ${pct(s.feeTolerancePct)} tolerance.`,
      ...capLines(lines),
      `Total over contract: ${usd(impact)}`,
    ].join("\n"),
  });
}

// (d) Outlier charges beyond N standard deviations of the category mean ---------------------------

function checkOutliers(claims: ClaimRow[], s: Settings): Finding[] {
  const byCategory = new Map<string, ClaimRow[]>();
  for (const c of claims) {
    if (isFeeRow(c) || isRebateRow(c)) continue;
    const k = key(c.category);
    const list = byCategory.get(k);
    if (list) list.push(c);
    else byCategory.set(k, [c]);
  }

  const lines: string[] = [];
  const evidence = [] as Finding["evidence"];
  let impact = 0;
  let count = 0;
  const sigma = Math.max(0, s.outlierSigma);

  for (const rows of byCategory.values()) {
    const n = rows.length;
    if (n < 8) continue; // too few claims for a meaningful average
    const total = sum(rows.map((r) => r.billed));
    const totalSq = sum(rows.map((r) => r.billed * r.billed));
    for (const r of rows) {
      // Compare each claim with the rest of its category so one huge claim cannot hide itself.
      const m = n - 1;
      const mean = (total - r.billed) / m;
      const variance = (totalSq - r.billed * r.billed - m * mean * mean) / (m - 1);
      const sd = Math.sqrt(Math.max(0, variance));
      if (sd <= 0 || r.billed <= mean + sigma * sd) continue;
      const excess = r.billed - mean;
      const counted = round2(Math.max(0, Math.min(excess, r.paid)));
      impact += counted;
      count += 1;
      lines.push(
        `${r.claimId} (${r.category}): ${usd(r.billed)} billed vs mean ${usd(mean)}, SD ${usd(sd)} → ` +
          `${round2((r.billed - mean) / sd)} SD above. Excess ${usd(excess)}, counted ${usd(counted)} (capped at ${usd(r.paid)} paid)`,
      );
      evidence.push(
        claimsEvidence(`Claim ${r.claimId} · ${r.category} · ${r.provider} · ${r.date} · ${usd(r.billed)} billed`),
      );
    }
  }
  if (count === 0) return [];
  impact = round2(impact);

  return [
    open({
      id: "f-outlier-charges",
      severity: severityFromImpact(impact),
      type: "outlier_charge",
      title: `${count} charge${count === 1 ? "" : "s"} far above the usual amount for ${count === 1 ? "its" : "their"} category`,
      explanation:
        `${count} claim${count === 1 ? " is" : "s are"} more than ${sigma} standard deviations above the average for ${count === 1 ? "its" : "their"} category. ` +
        `These may be legitimate high-cost care, but they are worth asking the administrator to explain.`,
      estimatedImpactUSD: impact,
      evidence,
      calc: [
        `Rule: billed amount > category mean + ${sigma} × standard deviation, measured against the other claims in the same category (minimum 8 claims).`,
        ...capLines(lines),
        `Total counted: ${usd(impact)}`,
      ].join("\n"),
    }),
  ];
}

// (e) Rebates received vs the guaranteed share ----------------------------------------------------

function checkRebates(claims: ClaimRow[], confirmed: ContractTerm[], s: Settings): Finding | null {
  const term = confirmed
    .filter((t) => t.category === "rebate_guarantee" && typeof t.value === "number" && t.unit === "%")
    .sort((a, b) => a.pageRef - b.pageRef)[0];
  if (!term) return null;
  const rate = term.value as number;

  // For rebate rows, `billed` is the rebate the manufacturer paid out and `paid` is what reached the plan.
  const rows = claims.filter(isRebateRow);
  const collected = round2(sum(rows.map((r) => r.billed)));
  if (rows.length === 0 || collected <= 0) return null;
  const received = round2(sum(rows.map((r) => r.paid)));
  const expected = round2((rate / 100) * collected);
  const shortfall = round2(expected - received);
  if (shortfall <= (s.feeTolerancePct / 100) * expected) return null;

  const byQuarter = new Map<string, { collected: number; received: number }>();
  for (const r of rows) {
    const q = periodOf(r.date)?.quarter ?? "unknown";
    const e = byQuarter.get(q) ?? { collected: 0, received: 0 };
    e.collected += r.billed;
    e.received += r.paid;
    byQuarter.set(q, e);
  }
  const quarterLines = [...byQuarter.keys()].sort().map((q) => {
    const e = byQuarter.get(q) as { collected: number; received: number };
    return `${q}: collected ${usd(e.collected)}, received ${usd(e.received)} (${pct((e.received / e.collected) * 100)})`;
  });

  return open({
    id: "f-rebate-shortfall",
    severity: severityFromImpact(shortfall),
    type: "rebate_shortfall",
    title: `Rebates received were ${pct((received / collected) * 100)} of the total, below the ${pct(rate)} guarantee`,
    explanation:
      `The contract guarantees that ${pct(rate)} of manufacturer rebates go to your plan. The claims show ${usd(collected)} collected ` +
      `and only ${usd(received)} passed through. Ask for a rebate reconciliation and payment of the shortfall.`,
    estimatedImpactUSD: shortfall,
    evidence: [contractEvidence(term), claimsEvidence(`Rebate entries: ${ids(rows.map((r) => r.claimId))}`)],
    calc: [
      `Guaranteed share: ${pct(rate)} (page ${term.pageRef})`,
      `Rebates collected (claims file): ${usd(collected)}`,
      `Expected to pass through: ${pct(rate)} × ${usd(collected)} = ${usd(expected)}`,
      `Actually received: ${usd(received)} (${pct((received / collected) * 100)} of collected)`,
      ...quarterLines,
      `Shortfall: ${usd(expected)} − ${usd(received)} = ${usd(shortfall)}`,
    ].join("\n"),
  });
}

// (f) Fees that went up between quarters with no matching clause ----------------------------------

function clauseCovers(clause: ContractTerm, feeType: string): boolean {
  const text = clause.snippet;
  if (key(text).includes(key(feeType))) return true;
  for (const re of Object.values(FEE_ALIASES)) {
    if (re.test(feeType) && re.test(text)) return true;
  }
  return /\b(?:all|any|each)\s+(?:fees|charges)\b/i.test(text);
}

function checkFeeIncreases(
  claims: ClaimRow[],
  confirmed: ContractTerm[],
  s: Settings,
  skip: Set<string>,
  adminFlagged: boolean,
): Finding[] {
  const clauses = confirmed.filter((t) => t.category === "price_adjustment");
  const byFee = new Map<string, { name: string; rows: ClaimRow[] }>();
  for (const c of claims) {
    if (!isFeeRow(c) || isRebateRow(c)) continue;
    const k = key(c.feeType as string);
    if (skip.has(k) || (adminFlagged && FEE_ALIASES.admin_fee?.test(k))) continue;
    const entry = byFee.get(k);
    if (entry) entry.rows.push(c);
    else byFee.set(k, { name: (c.feeType as string).trim(), rows: [c] });
  }

  const tol = s.feeTolerancePct / 100;
  const findings: Finding[] = [];

  for (const [k, { name, rows }] of byFee) {
    const quarters = new Map<string, number[]>();
    for (const r of rows) {
      const p = periodOf(r.date);
      if (!p) continue;
      const list = quarters.get(p.quarter) ?? [];
      list.push(r.billed);
      quarters.set(p.quarter, list);
    }
    const labels = [...quarters.keys()].sort();
    if (labels.length < 2) continue;

    const avg = (q: string): number => {
      const v = quarters.get(q) as number[];
      return sum(v) / v.length;
    };
    const baseline = avg(labels[0]);
    if (baseline <= 0) continue;

    const clause = clauses.find((c) => clauseCovers(c, name));
    const capPct = clause && typeof clause.value === "number" && clause.unit === "%" ? clause.value : null;
    if (clause && capPct === null) continue; // a clause covers this fee and sets no numeric cap
    const allowed = capPct === null ? baseline : baseline * (1 + capPct / 100);

    const lines: string[] = [];
    const evidenceBits: string[] = [];
    let impact = 0;
    for (const q of labels.slice(1)) {
      const a = avg(q);
      if (a <= allowed * (1 + tol) + 1e-9) continue;
      const n = (quarters.get(q) as number[]).length;
      const over = round2((a - allowed) * n);
      impact += over;
      lines.push(
        `${q}: average ${usd(a)} vs ${usd(allowed)} allowed (+${pct(((a - baseline) / baseline) * 100)} from ${labels[0]}). ` +
          `(${usd(a)} − ${usd(allowed)}) × ${n} charge${n === 1 ? "" : "s"} = ${usd(over)}`,
      );
      evidenceBits.push(`${q} ${usd(a)}`);
    }
    if (lines.length === 0) continue;
    impact = round2(impact);

    findings.push(
      open({
        id: `f-increase-${k.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        severity: severityFromImpact(impact),
        type: "unexplained_fee_increase",
        title: capPct === null
          ? `"${name}" increased with no price-adjustment clause`
          : `"${name}" increased more than the ${pct(capPct)} your contract allows`,
        explanation:
          capPct === null
            ? `The "${name}" charge rose from ${usd(baseline)} in ${labels[0]}, and none of your confirmed terms allows fee increases for it. Ask the administrator what authorised the change.`
            : `Your contract allows up to ${pct(capPct)} increases, but "${name}" rose by more than that from ${labels[0]}. Ask the administrator what authorised the change.`,
        estimatedImpactUSD: impact,
        evidence: [
          ...(clause ? [contractEvidence(clause)] : []),
          claimsEvidence(`"${name}" average per charge: ${labels[0]} ${usd(baseline)}, then ${evidenceBits.join(", ")}`),
        ],
        calc: [
          `Baseline: ${labels[0]} average ${usd(baseline)}. Tolerance ${pct(s.feeTolerancePct)}.`,
          capPct === null ? "Matching price-adjustment clause: none confirmed." : `Contract cap: ${pct(capPct)} → allowed ${usd(allowed)}.`,
          ...lines,
          `Total: ${usd(impact)}`,
        ].join("\n"),
      }),
    );
  }
  return findings;
}

// -------------------------------------------------------------------------------------------------

function rank(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    (b.estimatedImpactUSD ?? -1) - (a.estimatedImpactUSD ?? -1) ||
    a.id.localeCompare(b.id)
  );
}

/** Runs all checks. Contract-based checks only use confirmed terms and are skipped if none are confirmed. */
export function runChecks(terms: ContractTerm[], claims: ClaimRow[], settings: Settings): Finding[] {
  const confirmed = terms.filter((t) => t.confirmed);
  const findings: Finding[] = [...checkDuplicates(claims), ...checkOutliers(claims, settings)];

  if (confirmed.length > 0) {
    const uncontracted = checkUncontractedFees(claims, confirmed);
    const admin = checkAdminFee(claims, confirmed, settings);
    const rebate = checkRebates(claims, confirmed, settings);
    findings.push(
      ...uncontracted.findings,
      ...(admin ? [admin] : []),
      ...(rebate ? [rebate] : []),
      ...checkFeeIncreases(claims, confirmed, settings, uncontracted.flagged, admin !== null),
    );
  }
  return findings.sort(rank);
}
