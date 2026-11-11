import { LocalHeuristicAnalyzer } from "../src/analyzer/local";
import { summarizeFindings } from "../src/analyzer/summary";
import { DEFAULT_SETTINGS, type ContractTerm, type Finding } from "../src/analyzer/types";
import { EXPECTED_TERMS, PLANTED, SAMPLE_PAGES, generateSampleClaims, type PlantedProblem } from "../src/data/sample";

/**
 * Runs the analyzer on the sample contract and claims, then reports which planted
 * problems were found, which were missed, and which findings match nothing planted.
 * Exit code 1 when anything is missed or falsely raised, so it can run in CI.
 */

const analyzer = new LocalHeuristicAnalyzer();
const usd = (n: number | null): string => (n === null ? "n/a" : n.toLocaleString("en-US", { style: "currency", currency: "USD" }));
const mark = (ok: boolean): string => (ok ? "FOUND " : "MISSED");

function matchesFinding(p: PlantedProblem, f: Finding): boolean {
  if (p.detectedBy !== "findings" || f.type !== p.expect.findingType) return false;
  const haystack = `${f.title}\n${f.calc ?? ""}\n${f.evidence.map((e) => e.snippet).join("\n")}`;
  if (p.expect.feeType && !haystack.includes(p.expect.feeType)) return false;
  return (p.expect.claimIds ?? []).every((id) => haystack.includes(id));
}

function matchesTerm(p: PlantedProblem, t: ContractTerm): boolean {
  return (
    p.detectedBy === "terms" &&
    t.category === p.expect.termCategory &&
    t.pageRef === p.expect.page &&
    (p.expect.value === undefined || t.value === p.expect.value)
  );
}

async function main(): Promise<void> {
  const pages = SAMPLE_PAGES;
  const claims = generateSampleClaims();
  const terms = await analyzer.extractTerms(pages);

  // Act like a reviewer: confirm every high and medium confidence term, leave low ones unconfirmed.
  const reviewed = terms.map((t) => ({ ...t, confirmed: t.confidence !== "low" }));
  const settings = DEFAULT_SETTINGS;
  const findings = await analyzer.compare(reviewed, claims, settings);
  const again = await analyzer.compare(reviewed, claims, settings);
  const deterministic = JSON.stringify(findings) === JSON.stringify(again);

  console.log(`ContractSoup analyzer evaluation (${analyzer.version})`);
  console.log(`${pages.length} pages, ${claims.length} claims, ${terms.length} terms extracted, ${findings.length} findings\n`);

  console.log("Extracted terms");
  for (const t of terms) {
    console.log(`  p${String(t.pageRef).padStart(2)}  ${t.confidence.padEnd(6)}  ${t.category.padEnd(19)} ${String(t.value).padEnd(15)} ${t.unit}`);
  }

  console.log("\nExpected terms (correct contract terms that should be extracted)");
  let expectedMissed = 0;
  for (const e of EXPECTED_TERMS) {
    const ok = terms.some((t) => t.category === e.category && t.pageRef === e.page && t.value === e.value);
    if (!ok) expectedMissed += 1;
    console.log(`  ${mark(ok)} p${e.page} ${e.category} = ${e.value}`);
  }

  const unexpected = terms.filter(
    (t) =>
      !EXPECTED_TERMS.some((e) => e.category === t.category && e.page === t.pageRef && e.value === t.value) &&
      !PLANTED.some((p) => matchesTerm(p, t)),
  );
  console.log(`\nUnexpected terms (extracted but not in the expected list): ${unexpected.length}`);
  for (const t of unexpected) console.log(`  ? p${t.pageRef} ${t.category} = ${t.value} ${t.unit}`);

  console.log("\nPlanted problems");
  let missed = 0;
  const matchedFindings = new Set<string>();
  for (const p of PLANTED) {
    const hit =
      p.detectedBy === "findings" ? findings.find((f) => matchesFinding(p, f)) : terms.find((t) => matchesTerm(p, t));
    if (!hit) missed += 1;
    if (hit && "severity" in hit) matchedFindings.add(hit.id);
    const detail = hit && "severity" in hit ? `${hit.severity}, ${usd(hit.estimatedImpactUSD)}` : hit ? `term on page ${(hit as ContractTerm).pageRef}` : "";
    console.log(`  ${mark(Boolean(hit))} ${p.title}${detail ? ` (${detail})` : ""}`);
  }

  const falseAlarms = findings.filter((f) => !matchedFindings.has(f.id));
  console.log(`\nFalse alarms: ${falseAlarms.length}`);
  for (const f of falseAlarms) console.log(`  ! ${f.id}: ${f.title}`);

  const summary = summarizeFindings(findings);
  console.log("\nFindings");
  for (const f of findings) console.log(`  ${f.severity.toUpperCase().padEnd(6)} ${usd(f.estimatedImpactUSD).padStart(12)}  ${f.title}`);
  console.log(`\nTotal estimated exposure: ${usd(summary.exposureUSD)}`);
  console.log(`Deterministic: ${deterministic ? "yes" : "NO"}`);
  console.log(
    `\nResult: ${PLANTED.length - missed}/${PLANTED.length} planted found, ${missed} missed, ${falseAlarms.length} false alarms, ${expectedMissed} expected terms missed, ${unexpected.length} unexpected terms`,
  );

  if (missed > 0 || falseAlarms.length > 0 || expectedMissed > 0 || unexpected.length > 0 || !deterministic) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
