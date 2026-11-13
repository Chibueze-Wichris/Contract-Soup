import assert from "node:assert/strict";
import { test } from "node:test";
import { SAMPLE_PAGES } from "../src/data/sample.ts";
import { DEFAULT_LIMITS, geminiSettingsFromEnv, isUsableKey, limitsFromEnv } from "../supabase/functions/_shared/limits.ts";
import { BadModelOutput, RequestError, interpretModelOutput, parseModelJson, validateRequest } from "../supabase/functions/_shared/validate.ts";
import { SOUND_PROVISIONS, SOUND_RISKS, UNSOUND_PROVISIONS, sampleModelAnswer } from "./helpers/sampleAnswer.ts";

const L = DEFAULT_LIMITS;
const page = (n: number, text = `Text of page ${n}.`) => ({ page: n, text });

function rejects(body: unknown, status: number, code: string, limits = L): void {
  assert.throws(
    () => validateRequest(body, limits),
    (err: unknown) => err instanceof RequestError && err.status === status && err.code === code,
    `expected ${status} ${code}`,
  );
}

test("a well-formed request is accepted and its pages are put in order", () => {
  const out = validateRequest({ task: "extract", pages: [page(2), page(1)], documentPages: 12 }, L);
  assert.deepEqual(out, { task: "extract", pages: [page(1), page(2)], documentPages: 12 });
  assert.deepEqual(validateRequest({ task: "status" }, L), { task: "status" });
});

test("anything that is not page text is refused", () => {
  rejects({ task: "extract", pages: [page(1)], claims: [{ member: "M-1", paid: 10 }] }, 400, "unexpected_field");
  rejects({ task: "extract", pages: [{ page: 1, text: "x", member: "M-1" }] }, 400, "unexpected_field");
  rejects({ task: "extract", pages: [page(1)], fileName: "Acme.pdf" }, 400, "unexpected_field");
  rejects({ task: "extract", pages: [page(1)], model: "another-model" }, 400, "unexpected_field");
  rejects({ task: "status", pages: [page(1)] }, 400, "unexpected_field");
});

test("a request of the wrong shape is refused", () => {
  for (const body of [null, [], "text", 7, {}, { task: "summarise" }, { task: "extract" }, { task: "extract", pages: [] }, { task: "extract", pages: "all" }]) {
    rejects(body, 400, "invalid_request");
  }
  rejects({ task: "extract", pages: ["page one"] }, 400, "invalid_request");
  rejects({ task: "extract", pages: [{ page: 0, text: "x" }] }, 400, "invalid_request");
  rejects({ task: "extract", pages: [{ page: 1.5, text: "x" }] }, 400, "invalid_request");
  rejects({ task: "extract", pages: [{ page: "1", text: "x" }] }, 400, "invalid_request");
  rejects({ task: "extract", pages: [{ page: 1, text: 5 }] }, 400, "invalid_request");
  rejects({ task: "extract", pages: [page(1), page(1)] }, 400, "invalid_request");
  rejects({ task: "extract", pages: [page(1)], documentPages: -3 }, 400, "invalid_request");
  rejects({ task: "extract", pages: [page(1, "  \n "), page(2, "")] }, 400, "no_text");
});

test("size limits are enforced", () => {
  const small = { ...L, maxPages: 2, maxPageChars: 50, maxTotalChars: 80 };
  rejects({ task: "extract", pages: [page(1), page(2), page(3)] }, 413, "too_large", small);
  rejects({ task: "extract", pages: [page(1, "x".repeat(51))] }, 413, "too_large", small);
  rejects({ task: "extract", pages: [page(1, "x".repeat(45)), page(2, "y".repeat(45))] }, 413, "too_large", small);
  assert.equal(validateRequest({ task: "extract", pages: [page(1, "x".repeat(40)), page(2, "y".repeat(40))] }, small).task, "extract");
});

test("limits and settings come from the environment, and bad values fall back to the defaults", () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];
  assert.deepEqual(limitsFromEnv(env({})), L);
  assert.equal(limitsFromEnv(env({ AI_MAX_PAGES_PER_REQUEST: "10" })).maxPages, 10);
  assert.equal(limitsFromEnv(env({ AI_MAX_PAGES_PER_REQUEST: "lots" })).maxPages, L.maxPages);
  assert.equal(limitsFromEnv(env({ AI_MAX_PAGES_PER_REQUEST: "-1" })).maxPages, L.maxPages);

  const defaults = geminiSettingsFromEnv(env({}));
  assert.equal(defaults.model, "gemini-3.8-flash");
  assert.equal(defaults.baseUrl, "https://generativelanguage.googleapis.com");
  assert.equal(defaults.apiVersion, "v1beta");
  assert.equal(defaults.thinkingLevel, "");
  const custom = geminiSettingsFromEnv(env({ GEMINI_MODEL: "gemini-4-argon", GEMINI_THINKING_LEVEL: "low", GEMINI_MAX_RETRIES: "0", GEMINI_TIMEOUT_MS: "5000" }));
  assert.deepEqual([custom.model, custom.thinkingLevel, custom.maxRetries, custom.timeoutMs], ["gemini-4-argon", "low", 0, 5000]);
  assert.equal(geminiSettingsFromEnv(env({ GEMINI_MODEL: "bad model/../x" })).model, "gemini-3.8-flash");
});

test("a key that is missing or still the placeholder does not count as a key", () => {
  for (const key of [undefined, "", "   ", "YOUR_GEMINI_API_KEY_HERE", "your-key", "<key>", "changeme", "short"]) assert.equal(isUsableKey(key), false, String(key));
  assert.equal(isUsableKey("AIzaSyExampleExampleExampleExample000"), true);
});

test("parseModelJson reads JSON, with or without a code fence", () => {
  assert.deepEqual(parseModelJson('{"provisions":[],"risks":[]}'), { provisions: [], risks: [] });
  assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseModelJson("Here are the terms you asked for"), BadModelOutput);
  assert.throws(() => parseModelJson(""), BadModelOutput);
  assert.throws(() => parseModelJson('{"provisions":[{"ref":"t1"'), BadModelOutput);
});

test("an answer of the wrong overall shape is an unusable answer", () => {
  for (const data of [null, [], "x", {}, { provisions: [] }, { provisions: {}, risks: [] }]) {
    assert.throws(() => interpretModelOutput(data, SAMPLE_PAGES, L), BadModelOutput);
  }
});

test("sound provisions come through with their evidence checked", () => {
  const { terms, stats } = interpretModelOutput({ provisions: SOUND_PROVISIONS, risks: [] }, SAMPLE_PAGES, L);
  assert.equal(terms.length, SOUND_PROVISIONS.length);
  assert.deepEqual(stats.rejected, {});

  const admin = terms.find((t) => t.category === "admin_fee");
  assert.ok(admin);
  assert.deepEqual([admin.value, admin.unit, admin.page, admin.valueMatch, admin.confidence, admin.needsReview], [24.5, "USD PEPM", 4, "$24.50", "high", false]);
  assert.deepEqual(admin.relatedRefs, ["t13"]);
  assert.deepEqual(admin.relatedClauses, ["Section 9.1"]);

  const rebate = terms.find((t) => t.category === "rebate_guarantee");
  assert.deepEqual([rebate?.value, rebate?.unit, rebate?.valueMatch], [90, "%", "90"]);

  const clause = terms.find((t) => t.category === "spread_pricing");
  assert.deepEqual([clause?.value, clause?.unit, clause?.valueMatch], ["Pass-through; no spread", "", null]);

  const start = terms.find((t) => t.label === "Effective Date");
  assert.equal(start?.effectiveDate, "2025-01-01");
  assert.equal(start?.needsReview, false);

  const audit = terms.find((t) => t.category === "audit_rights");
  assert.deepEqual(audit?.noticePeriod, { value: 60, unit: "days" });

  const flagged = terms.find((t) => t.category === "termination_fee");
  assert.equal(flagged?.needsReview, true);
  assert.deepEqual(flagged?.reviewReasons, ["The fee sits in a records clause, away from the other fees."]);
});

test("every quotation that is returned is really on the page it names", () => {
  const { terms, risks } = interpretModelOutput(sampleModelAnswer(), SAMPLE_PAGES, L);
  const squash = (s: string): string => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, " ");
  const onPage = (pageNumber: number, quote: string): boolean => squash(SAMPLE_PAGES.find((p) => p.page === pageNumber)?.text ?? "").includes(squash(quote));
  for (const t of terms) assert.ok(onPage(t.page, t.quote), `${t.label} on page ${t.page}`);
  for (const r of risks) for (const e of r.evidence) assert.ok(onPage(e.page, e.quote), `${r.title} on page ${e.page}`);
});

test("unsupported and malformed provisions are left out and counted by reason", () => {
  const { terms, stats } = interpretModelOutput(sampleModelAnswer(), SAMPLE_PAGES, L);
  assert.deepEqual(stats.rejected, { quote_not_found: 2, unknown_category: 1, page_not_in_request: 1 }, "three provisions and one observation");
  assert.equal(stats.termsProposed, SOUND_PROVISIONS.length + 5);
  assert.equal(stats.termsAccepted, SOUND_PROVISIONS.length + 2);
  for (const bad of Object.values(UNSOUND_PROVISIONS)) assert.equal(terms.some((t) => t.label === bad.label), false, String(bad.label));
});

test("a wrong page number is put right when the wording is found on another page", () => {
  const { terms, stats } = interpretModelOutput(sampleModelAnswer(), SAMPLE_PAGES, L);
  const moved = terms.find((t) => t.label === "Initial Term");
  assert.equal(moved?.page, 3);
  assert.equal(moved?.confidence, "medium", "a corrected page is never high confidence");
  assert.equal(stats.pagesCorrected, 1);
});

test("a figure that is not in the quoted wording is flagged for review, not passed as sound", () => {
  const { terms } = interpretModelOutput(sampleModelAnswer(), SAMPLE_PAGES, L);
  const wrong = terms.find((t) => t.label === "Monthly reports");
  assert.ok(wrong);
  assert.equal(wrong.value, 25);
  assert.equal(wrong.valueMatch, null);
  assert.equal(wrong.needsReview, true);
  assert.equal(wrong.confidence, "low");
  assert.match(wrong.reviewReasons.join(" "), /25 was not found in the quoted wording/);
});

test("other checks on a provision: unit, dates, notice, duplicates, vocabulary", () => {
  const base = SOUND_PROVISIONS[0];
  const run = (changes: Record<string, unknown>) => interpretModelOutput({ provisions: [{ ...base, ...changes }], risks: [] }, SAMPLE_PAGES, L);

  const unit = run({ unit: "%" }).terms[0];
  assert.equal(unit.needsReview, true);
  assert.match(unit.reviewReasons[0], /does not show the unit/);

  const date = run({ effective_date: "2026-07-01", expiration_date: "soon" }).terms[0];
  assert.equal(date.effectiveDate, "2026-07-01");
  assert.equal(date.expirationDate, null);
  assert.equal(date.reviewReasons.length, 2);

  const notice = run({ notice_value: 45, notice_unit: "days" }).terms[0];
  assert.deepEqual(notice.noticePeriod, { value: 45, unit: "days" });
  assert.match(notice.reviewReasons[0], /notice period of 45 days was not found/);

  assert.deepEqual(run({ unit: "EUR" }).stats.rejected, { unknown_unit: 1 });
  assert.deepEqual(run({ confidence: "certain" }).stats.rejected, { malformed: 1 });
  assert.deepEqual(run({ quote: "fee of $24.50" }).stats.rejected, { quote_too_short: 1 });
  assert.deepEqual(run({ quote: 12 }).stats.rejected, { malformed: 1 });
  assert.deepEqual(interpretModelOutput({ provisions: [base, { ...base, ref: "t99" }, "junk"], risks: [] }, SAMPLE_PAGES, L).stats.rejected, { duplicate: 1, malformed: 1 });

  const words = run({ value_number: null, value_text: "x".repeat(500), unit: "USD" }).terms[0];
  assert.equal(words.unit, "", "a unit is dropped when there is no figure");
  assert.equal(typeof words.value === "string" && words.value.length <= 120, true);
});

test("no more than the allowed number of items is kept", () => {
  const many = Array.from({ length: 5 }, (_, i) => ({ ...SOUND_PROVISIONS[i], ref: `x${i}` }));
  const out = interpretModelOutput({ provisions: many, risks: SOUND_RISKS }, SAMPLE_PAGES, { ...L, maxTerms: 3, maxRisks: 2 });
  assert.equal(out.terms.length, 3);
  assert.equal(out.risks.length, 2);
  assert.deepEqual(out.stats.rejected, { over_limit: 4 });
});

test("observations keep only evidence that is really in the pages, and need at least one", () => {
  const { risks, stats } = interpretModelOutput(sampleModelAnswer(), SAMPLE_PAGES, L);
  assert.equal(risks.length, SOUND_RISKS.length);
  assert.equal(stats.risksProposed, SOUND_RISKS.length + 1);
  assert.equal(risks.some((r) => /at will/.test(r.title)), false, "an observation with made-up evidence is left out");

  const audit = risks.find((r) => r.kind === "restriction");
  assert.equal(audit?.evidence.length, 2);
  assert.deepEqual(audit?.relatedRefs, ["t12"]);

  const unsure = risks.find((r) => r.kind === "ambiguity");
  assert.deepEqual([unsure?.needsReview, unsure?.confidence], [true, "low"]);

  const mixed = interpretModelOutput(
    { provisions: [], risks: [{ ...SOUND_RISKS[0], evidence: [{ page: 12, quote: "Client shall pay nothing further under any circumstances at all." }, ...(SOUND_RISKS[0].evidence as unknown[])] }] },
    SAMPLE_PAGES,
    L,
  );
  assert.equal(mixed.risks[0].evidence.length, 1, "the made-up quotation is dropped and the real one kept");
  assert.deepEqual(mixed.risks[0].relatedRefs, [], "a link to a provision that is not in the answer is dropped");
});
