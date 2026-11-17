/**
 * What an audit read by Gemini looks like once it is saved, read back and printed.
 *
 *   - everything the AI reader adds survives saving and reading, and nothing else gets in;
 *   - reports saved before the AI reader existed still open;
 *   - a record that claims an amount for an AI observation is refused;
 *   - the PDF says that Gemini read the contract and never prints a dollar figure for an observation.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { GeminiAnalyzer, MAX_AI_OBSERVATIONS, MAX_AI_TERMS } from "../src/analyzer/gemini";
import { LocalHeuristicAnalyzer } from "../src/analyzer/local";
import { summarizeFindings } from "../src/analyzer/summary";
import { DEFAULT_SETTINGS, type Audit, type ContractTerm, type Finding } from "../src/analyzer/types";
import { SAMPLE_FILE_NAME, SAMPLE_PAGES, generateSampleClaims } from "../src/data/sample";
import { geminiModel, geminiName, usedGemini } from "../src/lib/analyzerText";
import { buildBackup, fromRow, parseAudit, parseBackup, toRecord, toRow } from "../src/lib/auditRecord";
import { NO_FILTER, awaitsReview, countBySource, filterFindings, impactText, isAiFinding } from "../src/lib/findings";
import { aiDisclosure, buildReportPdf } from "../src/lib/reportPdf";
import { describeIsoDate, describeNoticePeriod, pageList, readingNotes, termNotes } from "../src/lib/terms";
import { makeWire } from "./helpers/client";
import { readExtractResponse } from "../supabase/functions/_shared/wire.ts";

const AUDIT_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const USER = "3f1c2b9e-5d7a-4c1e-9a55-0b8f6d2e7a11";

async function geminiAudit(): Promise<Audit> {
  const analyzer = new GeminiAnalyzer(makeWire().transport);
  const claims = generateSampleClaims();
  const terms = (await analyzer.extractTerms(SAMPLE_PAGES)).map((t) => ({ ...t, confirmed: !t.needsReview }));
  const findings = await analyzer.compare(terms, claims, DEFAULT_SETTINGS);
  return {
    id: AUDIT_ID,
    name: "Harborview 2025 check",
    createdAt: "2026-11-11T09:30:00.000Z",
    contractFileName: SAMPLE_FILE_NAME,
    pageCount: SAMPLE_PAGES.length,
    claimsCount: claims.length,
    terms,
    findings,
    summary: summarizeFindings(findings),
    analyzerVersion: analyzer.version,
  };
}

async function localAudit(): Promise<Audit> {
  const analyzer = new LocalHeuristicAnalyzer();
  const claims = generateSampleClaims();
  const terms = (await analyzer.extractTerms(SAMPLE_PAGES)).map((t) => ({ ...t, confirmed: t.confidence !== "low" }));
  const findings = await analyzer.compare(terms, claims, DEFAULT_SETTINGS);
  return {
    id: AUDIT_ID,
    name: "Harborview 2025 check",
    createdAt: "2026-11-11T09:30:00.000Z",
    contractFileName: SAMPLE_FILE_NAME,
    pageCount: SAMPLE_PAGES.length,
    claimsCount: claims.length,
    terms,
    findings,
    summary: summarizeFindings(findings),
    analyzerVersion: analyzer.version,
  };
}

const viaJson = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

test("an audit read by Gemini is saved and read back with nothing lost and nothing added", async () => {
  const audit = await geminiAudit();
  const record = toRecord(audit);
  assert.deepEqual(record, audit, "every field the AI reader sets is one a record may hold");

  assert.deepEqual(parseAudit(viaJson(record)), audit, "from this device");
  assert.deepEqual(fromRow(viaJson(toRow(audit, USER))), audit, "from the account");
  const backup = parseBackup(buildBackup([audit]));
  assert.equal(backup.ok, true);
  if (backup.ok) assert.deepEqual(backup.audits, [audit]);

  // The fields under test really are there.
  assert.ok(audit.terms.some((t) => t.summary && t.conditions && t.relatedClauses));
  assert.ok(audit.terms.some((t) => t.noticePeriod));
  assert.ok(audit.terms.some((t) => t.effectiveDate));
  assert.ok(audit.terms.some((t) => t.needsReview && t.reviewReasons?.length));
  assert.ok(audit.terms.some((t) => t.relatedTermIds?.length));
  assert.ok(audit.findings.some((f) => f.origin === "ai" && f.confidence && f.relatedTermIds?.length));
});

test("page text or claim rows attached to an audit by mistake are not saved", async () => {
  const audit = await geminiAudit();
  const dirty = {
    ...audit,
    pages: SAMPLE_PAGES,
    claims: generateSampleClaims(),
    terms: audit.terms.map((t) => ({ ...t, pageText: SAMPLE_PAGES[0].text, modelAnswer: "raw" })),
    findings: audit.findings.map((f) => ({ ...f, claimRows: generateSampleClaims().slice(0, 2) })),
  } as unknown as Audit;
  const text = JSON.stringify(toRecord(dirty));
  assert.deepEqual(JSON.parse(text), viaJson(audit));
  assert.equal(text.includes("pageText"), false);
  assert.equal(text.includes("claimRows"), false);
});

test("a report saved before the AI reader existed still opens, unchanged", async () => {
  const audit = await localAudit();
  for (const t of audit.terms) assert.equal("origin" in t, false);
  assert.deepEqual(parseAudit(viaJson(audit)), audit);
  assert.equal(usedGemini(audit), false);
  assert.equal(geminiModel(audit), null);
  assert.equal(countBySource(audit.findings).ai, 0);
});

test("a record with a malformed AI field is refused, not half-read", async () => {
  const audit = await geminiAudit();
  const withTerm = (patch: Record<string, unknown>): unknown => ({ ...audit, terms: [{ ...audit.terms[0], ...patch }, ...audit.terms.slice(1)] });
  const aiFinding = audit.findings.find((f) => f.origin === "ai") as Finding;
  const withFinding = (patch: Record<string, unknown>): unknown => ({ ...audit, findings: [...audit.findings.filter((f) => f !== aiFinding), { ...aiFinding, ...patch }] });

  const bad: [string, unknown][] = [
    ["an unknown origin", withTerm({ origin: "robot" })],
    ["a date in words", withTerm({ effectiveDate: "next week" })],
    ["a negative notice period", withTerm({ noticePeriod: { value: -1, unit: "days" } })],
    ["a notice period in weeks", withTerm({ noticePeriod: { value: 2, unit: "weeks" } })],
    ["conditions that are not a list", withTerm({ conditions: "always" })],
    ["a list holding something that is not text", withTerm({ exceptions: ["fine", 7] })],
    ["a flag that is not yes or no", withTerm({ needsReview: "yes" })],
    ["a summary that is not text", withTerm({ summary: { text: "x" } })],
    ["an unknown confidence on a finding", withFinding({ confidence: "certain" })],
    ["an unknown origin on a finding", withFinding({ origin: "human" })],
    ["related terms that are not a list", withFinding({ relatedTermIds: "ai-1" })],
    ["an AI observation that claims an amount", withFinding({ estimatedImpactUSD: 125000 })],
  ];
  for (const [name, record] of bad) assert.equal(parseAudit(viaJson(record)), null, `${name} must be refused`);
  assert.notEqual(parseAudit(viaJson(withTerm({}))), null);
});

test("the totals are worked out again when a record is read, and observations add nothing to them", async () => {
  const audit = await geminiAudit();
  const tampered = { ...audit, summary: { exposureUSD: 9_999_999, bySeverity: { high: 99 }, byType: { ai_cost_exposure: 5_000_000 } } };
  const read = parseAudit(viaJson(tampered));
  assert.ok(read);
  assert.deepEqual(read.summary, audit.summary);
  assert.equal(read.summary.exposureUSD, 33116.41);
  assert.equal(read.summary.exposureUSD, summarizeFindings(read.findings.filter((f) => !isAiFinding(f))).exposureUSD);
});

test("the largest answer the app accepts from the function still makes a record that can be read back", () => {
  const long = (n: number): string => "x".repeat(n);
  const body = {
    model: long(200),
    terms: [
      {
        ref: long(64),
        category: "other_provision",
        label: long(300),
        value: long(300),
        unit: "",
        page: 1,
        quote: long(5000),
        valueMatch: null,
        confidence: "low",
        needsReview: true,
        reviewReasons: Array.from({ length: 20 }, (_, i) => `${i} ${long(1990)}`),
        summary: long(2000),
        conditions: Array.from({ length: 50 }, (_, i) => `${i} ${long(1990)}`),
        exceptions: Array.from({ length: 50 }, (_, i) => `${i} ${long(1990)}`),
        effectiveDate: "2025-01-01",
        expirationDate: "2027-12-31",
        noticePeriod: { value: 90, unit: "days" },
        relatedClauses: Array.from({ length: 50 }, (_, i) => `${i} ${long(1990)}`),
        relatedRefs: [],
      },
    ],
    risks: [],
    stats: {},
  };
  const answer = readExtractResponse(body);
  assert.ok(answer, "this is the largest shape the app accepts");
  const t = answer.terms[0];
  const term: ContractTerm = {
    id: "ai-1",
    category: t.category,
    label: t.label,
    value: t.value,
    unit: t.unit,
    pageRef: t.page,
    snippet: t.quote,
    confidence: t.confidence,
    confirmed: false,
    origin: "ai",
    summary: t.summary,
    conditions: t.conditions,
    exceptions: t.exceptions,
    effectiveDate: t.effectiveDate ?? undefined,
    expirationDate: t.expirationDate ?? undefined,
    noticePeriod: t.noticePeriod ?? undefined,
    relatedClauses: t.relatedClauses,
    needsReview: true,
    reviewReasons: t.reviewReasons,
  };
  const audit: Audit = {
    id: AUDIT_ID,
    name: "Largest",
    createdAt: "2026-11-11T09:30:00.000Z",
    contractFileName: "c.pdf",
    pageCount: 1,
    claimsCount: 0,
    terms: [term],
    findings: [],
    summary: summarizeFindings([]),
    analyzerVersion: `gemini-hybrid-1.0.0 (${answer.model}) + local-heuristic-1.0.0`,
  };
  assert.deepEqual(parseAudit(viaJson(toRecord(audit))), audit);

  // A name longer than a saved audit allows is refused on arrival, not after the audit has been saved.
  assert.equal(readExtractResponse({ ...body, terms: [{ ...body.terms[0], label: long(501) }] }), null);
  assert.equal(readExtractResponse({ ...body, terms: [{ ...body.terms[0], value: long(501) }] }), null);

  // As many terms as one reading may hold can be saved.
  const many: Audit = { ...audit, terms: Array.from({ length: MAX_AI_TERMS }, (_, i) => ({ ...term, id: `ai-${i + 1}`, summary: "s", conditions: [], exceptions: [], relatedClauses: [], reviewReasons: ["r"], snippet: "q" })) };
  assert.equal(parseAudit(viaJson(toRecord(many)))?.terms.length, MAX_AI_TERMS);
  assert.ok(MAX_AI_OBSERVATIONS <= 5000);
});

test("display helpers: source filter, review flags, dates and notice periods", async () => {
  const audit = await geminiAudit();
  const counts = countBySource(audit.findings);
  assert.deepEqual(counts, { checks: 6, ai: 4 });
  assert.equal(filterFindings(audit.findings, { ...NO_FILTER, source: "ai" }).every(isAiFinding), true);
  assert.equal(filterFindings(audit.findings, { ...NO_FILTER, source: "checks" }).some(isAiFinding), false);
  assert.equal(filterFindings(audit.findings, NO_FILTER).length, 10);

  const observation = audit.findings.find(isAiFinding) as Finding;
  assert.equal(impactText(observation), "No estimate");
  const unsure = audit.findings.find((f) => f.needsReview) as Finding;
  assert.equal(awaitsReview(unsure), true);
  assert.equal(awaitsReview({ ...unsure, status: "confirmed" }), false);

  assert.equal(describeIsoDate("2025-01-01"), "January 1, 2025");
  assert.equal(describeIsoDate("2027-12-31"), "December 31, 2027");
  assert.equal(describeNoticePeriod({ value: 90, unit: "days" }), "90 days");
  assert.equal(describeNoticePeriod({ value: 1, unit: "years" }), "1 year");

  const renewal = audit.terms.find((t) => t.category === "auto_renewal") as ContractTerm;
  assert.ok(termNotes(renewal).includes("Notice period: 90 days"));
  assert.deepEqual(termNotes((await localAudit()).terms[0]), []);

  assert.equal(usedGemini(audit), true);
  assert.equal(geminiModel(audit), "gemini-3.8-flash");
  assert.equal(geminiName(audit), "Google Gemini (gemini-3.8-flash)");
});

// ---- The PDF ----

/** The text drawn in a PDF, with line breaks inside a sentence joined up. */
function pdfWords(audit: Audit): string {
  const doc = buildReportPdf(audit, jsPDF, autoTable as unknown as Parameters<typeof buildReportPdf>[2]);
  const raw = Buffer.from(doc.output("arraybuffer")).toString("latin1");
  const shown = [...raw.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, "$1"));
  return shown.join(" ").replace(/\s+/g, " ");
}

test("the notes on a reading say what was left out and which pages may be incomplete, and nothing when there is nothing to say", () => {
  const clean = { model: "gemini-3.8-flash", termsLeftOut: 0, observationsLeftOut: 0, observations: 0, pagesCorrected: 0, pagesAtLimit: [], requests: 1 };
  assert.deepEqual(readingNotes(clean), { leftOut: null, incomplete: null });

  const one = readingNotes({ ...clean, termsLeftOut: 1 });
  assert.match(one.leftOut ?? "", /^1 item Gemini proposed was left out, because it failed an automatic check/);
  const several = readingNotes({ ...clean, termsLeftOut: 2, observationsLeftOut: 1 });
  assert.match(several.leftOut ?? "", /^3 items Gemini proposed were left out, because they failed an automatic check/);

  const onePage = readingNotes({ ...clean, pagesAtLimit: [7] }).incomplete;
  assert.equal(onePage?.title, "Page 7 may hold more terms");
  assert.match(onePage?.text ?? "", /^On page 7, Gemini reached the most terms it reports for a single page, so that page may hold terms that are not listed here/);
  assert.match(onePage?.text ?? "", /Add a term/);
  const morePages = readingNotes({ ...clean, pagesAtLimit: [9, 7] }).incomplete;
  assert.equal(morePages?.title, "Some pages may hold more terms");
  assert.match(morePages?.text ?? "", /^On pages 7 and 9, .* those pages may hold/);

  assert.equal(pageList([]), "");
  assert.equal(pageList([3]), "page 3");
  assert.equal(pageList([12, 3, 3]), "pages 3 and 12");
  assert.equal(pageList([1, 2, 3]), "pages 1, 2 and 3");
  assert.equal(pageList([1, 2, 3, 4, 5, 6, 7, 8]), "pages 1, 2, 3, 4, 5, 6 and 2 more");
});

test("the PDF of an audit read by Gemini says so, and prints no amount for an observation", async () => {
  const audit = await geminiAudit();
  const words = pdfWords(audit);

  assert.match(words, /The contract was read by Google Gemini \(gemini-3\.8-flash\)/);
  assert.match(words, /confirmed by a person/);
  assert.match(words, /An AI reading can still be wrong or incomplete/);
  assert.match(words, /AI reading: /);
  assert.match(words, /No dollar estimate/);
  assert.match(words, /What Gemini noticed/);
  assert.match(words, /from 6 findings of the money checks/);
  assert.match(words, /\$33,116\.41/);
  assert.match(words, /gemini-hybrid-1\.0\.0/);

  // Each observation's own block carries no dollar figure of its own making.
  for (const f of audit.findings.filter(isAiFinding)) {
    assert.equal(f.estimatedImpactUSD, null);
    assert.equal(impactText(f), "No estimate");
  }
  assert.equal(/Estimated impact: \$[\d,.]+ [^·]*AI reading/.test(words), false);

  assert.match(aiDisclosure(audit), /4 findings marked "AI reading" are observations/);
});

test("the PDF of an audit read by the built-in reader does not mention Gemini", async () => {
  const words = pdfWords(await localAudit());
  assert.equal(/Gemini|AI reading/.test(words), false);
  assert.match(words, /\$33,116\.41 across 6 findings/);
  assert.match(words, /local-heuristic/);
});
