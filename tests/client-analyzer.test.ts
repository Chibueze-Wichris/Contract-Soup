/**
 * The web app's side of the AI reader, run against the real Edge Function handler.
 *
 * What these tests hold the app to:
 *   - the only thing that leaves the device is page numbers and page text;
 *   - every term arrives unconfirmed, with wording that really is on its page;
 *   - the money comes from the same deterministic checks as the built-in reader, and nothing
 *     Gemini says can change an amount;
 *   - when Gemini cannot be used the reading fails with a clear error. It is never replaced
 *     by another reader behind the user's back.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { MONEY_CATEGORIES, PROVISION_CATEGORIES } from "../supabase/functions/_shared/categories.ts";
import { CLIENT_BATCH, DEFAULT_LIMITS } from "../supabase/functions/_shared/limits.ts";
import { PROVISION_CATEGORIES as APP_PROVISION_CATEGORIES, TERM_CATEGORIES, categoryLabel, isMoneyCategory } from "../src/analyzer/categories";
import { AiReaderError, GeminiAnalyzer, splitIntoBatches, type AiTransport } from "../src/analyzer/gemini";
import { LOCAL_ANALYZER_VERSION, LocalHeuristicAnalyzer } from "../src/analyzer/local";
import { summarizeFindings } from "../src/analyzer/summary";
import { DEFAULT_SETTINGS, type ContractTerm, type Finding } from "../src/analyzer/types";
import { SAMPLE_FILE_NAME, SAMPLE_PAGES, generateSampleClaims } from "../src/data/sample";
import { isOnPage, longSample, makeWire } from "./helpers/client";
import { sampleModelAnswerFor } from "./helpers/sampleAnswer";
import { jsonResponse } from "./helpers/stubs";

const confirmAll = (terms: ContractTerm[]): ContractTerm[] => terms.map((t) => ({ ...t, confirmed: true }));
const moneyOnly = (findings: Finding[]): Finding[] => findings.filter((f) => f.origin !== "ai");
const aiOnly = (findings: Finding[]): Finding[] => findings.filter((f) => f.origin === "ai");

async function failure(run: () => Promise<unknown>): Promise<AiReaderError> {
  try {
    await run();
  } catch (err) {
    assert.ok(err instanceof AiReaderError, `expected an AiReaderError, got ${String(err)}`);
    return err;
  }
  throw new Error("expected the reading to fail, but it returned");
}

// ---- The vocabulary cannot drift ----

test("the money categories the function may use are exactly the app's 14, with the same names", () => {
  assert.deepEqual(
    MONEY_CATEGORIES.map((c) => [c.id, c.label]),
    TERM_CATEGORIES.map((c) => [c.id, c.label]),
  );
  assert.equal(TERM_CATEGORIES.length, 14);
  for (const c of MONEY_CATEGORIES) assert.equal(isMoneyCategory(c.id), true);
});

test("the wider provision categories are never treated as money categories", () => {
  assert.deepEqual(
    APP_PROVISION_CATEGORIES.map((c) => c.id),
    PROVISION_CATEGORIES.map((c) => c.id),
  );
  const money = new Set<string>(TERM_CATEGORIES.map((c) => c.id));
  for (const c of PROVISION_CATEGORIES) {
    assert.equal(money.has(c.id), false, `${c.id} must not be one of the 14`);
    assert.equal(isMoneyCategory(c.id), false);
    assert.equal(categoryLabel(c.id), c.label);
  }
});

// ---- A good reading ----

test("the sample is read through the function: unconfirmed terms, each with wording that is on its page", async () => {
  const wire = makeWire();
  const analyzer = new GeminiAnalyzer(wire.transport);
  const progress: string[] = [];
  const terms = await analyzer.extractTerms(SAMPLE_PAGES, { onProgress: (p) => progress.push(`${p.pagesDone}/${p.pagesTotal}`) });

  assert.equal(wire.sent.length, 1, "the 12-page sample fits in one request");
  assert.ok(terms.length >= 18);
  assert.deepEqual(
    terms.map((t) => t.id),
    terms.map((_, i) => `ai-${i + 1}`),
  );
  assert.deepEqual(
    terms.map((t) => t.pageRef),
    [...terms.map((t) => t.pageRef)].sort((a, b) => a - b),
    "terms are in page order",
  );
  for (const t of terms) {
    assert.equal(t.confirmed, false, `${t.label} must arrive unconfirmed`);
    assert.equal(t.origin, "ai");
    assert.ok(isOnPage(SAMPLE_PAGES, t.pageRef, t.snippet), `the wording quoted for "${t.label}" is not on page ${t.pageRef}`);
    for (const id of t.relatedTermIds ?? []) assert.ok(terms.some((other) => other.id === id), "a related term must exist");
  }
  assert.equal(progress[0], "0/12");
  assert.equal(progress.at(-1), "12/12");

  // The made-up fee and the made-up category are gone.
  assert.equal(terms.some((t) => /implementation fee/i.test(t.label)), false);
  assert.equal(terms.some((t) => t.label === "Made-up category"), false);

  // Wording that was on another page is filed under the page it is really on, and trusted less.
  const initialTerm = terms.find((t) => t.label === "Initial Term");
  assert.ok(initialTerm);
  assert.equal(initialTerm.pageRef, 3);
  assert.equal(initialTerm.confidence, "medium");
  assert.equal(initialTerm.unit, "years");

  // A figure that is not in the quoted wording is kept, but flagged and never trusted.
  const reports = terms.find((t) => t.label === "Monthly reports");
  assert.ok(reports);
  assert.equal(reports.needsReview, true);
  assert.equal(reports.confidence, "low");
  assert.match((reports.reviewReasons ?? []).join(" "), /25/);

  // What Gemini understood is carried along.
  const adminFee = terms.find((t) => t.category === "admin_fee");
  assert.ok(adminFee);
  assert.equal(adminFee.value, 24.5);
  assert.equal(adminFee.unit, "USD PEPM");
  assert.match(adminFee.summary ?? "", /24\.50/);
  assert.deepEqual(adminFee.conditions, ["Invoiced monthly on the basis of enrolled employees"]);
  assert.deepEqual(adminFee.relatedClauses, ["Section 9.1"]);
  const renewal = terms.find((t) => t.category === "auto_renewal");
  assert.deepEqual(renewal?.noticePeriod, { value: 90, unit: "days" });
  assert.equal(terms.find((t) => t.label === "Effective Date")?.effectiveDate, "2025-01-01");

  const report = analyzer.report;
  assert.ok(report);
  assert.equal(report.model, "gemini-3.8-flash");
  assert.equal(report.termsLeftOut, 2, "the made-up fee and the made-up category");
  assert.equal(report.observationsLeftOut, 1);
  assert.equal(report.observations, 4);
  assert.equal(report.pagesCorrected, 1);
  assert.equal(analyzer.version, `gemini-hybrid-1.0.0 (gemini-3.8-flash) + ${LOCAL_ANALYZER_VERSION}`);
});

// ---- Privacy ----

test("only page numbers and page text are sent, and running the audit sends nothing", async () => {
  const wire = makeWire();
  const analyzer = new GeminiAnalyzer(wire.transport);
  const terms = await analyzer.extractTerms(SAMPLE_PAGES);
  const claims = generateSampleClaims();

  const before = wire.sent.length;
  const findings = await analyzer.compare(confirmAll(terms), claims, DEFAULT_SETTINGS);
  assert.ok(findings.length > 0);
  assert.equal(wire.sent.length, before, "compare must not call the function");
  assert.equal(wire.world.seen.length, wire.world.seen.length);

  for (const text of wire.sent) {
    const body = JSON.parse(text) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["documentPages", "pages", "task"]);
    assert.equal(body.task, "extract");
    assert.equal(body.documentPages, SAMPLE_PAGES.length);
    for (const page of body.pages as Record<string, unknown>[]) {
      assert.deepEqual(Object.keys(page).sort(), ["page", "text"]);
      assert.equal(typeof page.page, "number");
      assert.equal(page.text, SAMPLE_PAGES.find((p) => p.page === page.page)?.text);
    }
    assert.equal(text.includes(SAMPLE_FILE_NAME), false, "the file name must not be sent");
  }

  // Nothing from the claims file is in anything that left the device, or in anything sent on to Gemini.
  const outgoing = [...wire.sent, ...wire.world.seen.map((r) => `${r.url}\n${r.body}`)].join("\n");
  for (const claim of claims) {
    assert.equal(outgoing.includes(claim.claimId), false, `claim ${claim.claimId} must never be sent`);
    if (claim.member) assert.equal(outgoing.includes(claim.member), false, "member identifiers must never be sent");
  }
});

test("blank pages are not sent, and a contract is split into requests the function accepts", async () => {
  const pages = longSample();
  pages.push({ page: 13, text: "   \n  " });
  const batches = splitIntoBatches(pages);
  assert.ok(batches.length >= 3, "the padded sample needs several requests");
  assert.deepEqual(
    batches.flat().map((p) => p.page),
    SAMPLE_PAGES.map((p) => p.page),
    "every page with text is sent once, in order, and the blank page is not",
  );
  for (const batch of batches) {
    assert.ok(batch.length <= CLIENT_BATCH.maxPages);
    assert.ok(batch.reduce((n, p) => n + p.text.length, 0) <= CLIENT_BATCH.maxChars);
    assert.ok(batch.length <= DEFAULT_LIMITS.maxPages);
  }

  const tooLong = [{ page: 1, text: "x".repeat(DEFAULT_LIMITS.maxPageChars + 1) }];
  assert.throws(() => splitIntoBatches(tooLong), (err: unknown) => err instanceof AiReaderError && err.code === "too_large");
});

test("a contract read in several requests gives the same terms as one read in a single request", async () => {
  const single = new GeminiAnalyzer(makeWire().transport);
  const expected = await single.extractTerms(SAMPLE_PAGES);

  const wire = makeWire();
  const analyzer = new GeminiAnalyzer(wire.transport);
  const terms = await analyzer.extractTerms(longSample());
  assert.ok(wire.sent.length >= 3);

  assert.deepEqual(
    terms.map((t) => [t.label, t.pageRef]),
    expected.map((t) => [t.label, t.pageRef]),
    "the same terms, in the same order",
  );
  assert.deepEqual(
    terms.map((t) => t.id),
    terms.map((_, i) => `ai-${i + 1}`),
    "ids are given once, across all requests",
  );
  for (const t of terms) {
    const same = expected.find((e) => e.label === t.label && e.pageRef === t.pageRef);
    assert.ok(same, `${t.label} should also be found when the contract is read in one request`);
    assert.equal(t.value, same.value);
    assert.equal(t.unit, same.unit);
    assert.equal(t.snippet, same.snippet);
    for (const id of t.relatedTermIds ?? []) assert.ok(terms.some((other) => other.id === id));
  }
});

// ---- The money ----

test("the money checks give the same findings as the built-in analyzer for the same terms", async () => {
  const claims = generateSampleClaims();
  const local = new LocalHeuristicAnalyzer();
  const localTerms = (await local.extractTerms(SAMPLE_PAGES)).map((t) => ({ ...t, confirmed: t.confidence !== "low" }));
  const expected = await local.compare(localTerms, claims, DEFAULT_SETTINGS);
  assert.equal(summarizeFindings(expected).exposureUSD, 33116.41);

  // Handed the very same terms, the hybrid analyzer must produce the very same money findings.
  const wire = makeWire();
  const analyzer = new GeminiAnalyzer(wire.transport);
  await analyzer.extractTerms(SAMPLE_PAGES);
  const findings = await analyzer.compare(localTerms, claims, DEFAULT_SETTINGS);
  assert.deepEqual(moneyOnly(findings), expected);
});

test("terms read by Gemini and confirmed lead to the same six money findings and the same exposure", async () => {
  const claims = generateSampleClaims();
  const local = new LocalHeuristicAnalyzer();
  const localTerms = (await local.extractTerms(SAMPLE_PAGES)).map((t) => ({ ...t, confirmed: t.confidence !== "low" }));
  const expected = await local.compare(localTerms, claims, DEFAULT_SETTINGS);

  const analyzer = new GeminiAnalyzer(makeWire().transport);
  const terms = confirmAll(await analyzer.extractTerms(SAMPLE_PAGES));
  const findings = await analyzer.compare(terms, claims, DEFAULT_SETTINGS);
  const money = moneyOnly(findings);

  assert.deepEqual(
    money.map((f) => [f.type, f.estimatedImpactUSD]).sort(),
    expected.map((f) => [f.type, f.estimatedImpactUSD]).sort(),
  );
  assert.equal(summarizeFindings(findings).exposureUSD, 33116.41);
  assert.equal(JSON.stringify(await analyzer.compare(terms, claims, DEFAULT_SETTINGS)), JSON.stringify(findings), "the same input gives the same output");
});

test("what Gemini noticed is listed as AI findings with no amount, and adds nothing to any total", async () => {
  const claims = generateSampleClaims();
  const analyzer = new GeminiAnalyzer(makeWire().transport);
  const terms = confirmAll(await analyzer.extractTerms(SAMPLE_PAGES));
  const findings = await analyzer.compare(terms, claims, DEFAULT_SETTINGS);
  const observed = aiOnly(findings);

  assert.equal(observed.length, 4);
  assert.deepEqual(
    observed.map((f) => f.id),
    ["f-ai-1", "f-ai-2", "f-ai-3", "f-ai-4"],
  );
  assert.deepEqual(
    observed.map((f) => f.severity),
    ["high", "medium", "medium", "low"],
  );
  for (const f of observed) {
    assert.equal(f.estimatedImpactUSD, null, "an observation never carries an amount");
    assert.match(f.type, /^ai_/);
    assert.equal(f.status, "open");
    assert.equal(f.calc, undefined);
    assert.ok(f.evidence.length > 0);
    for (const e of f.evidence) assert.ok(isOnPage(SAMPLE_PAGES, e.page, e.snippet), `evidence for "${f.title}" is not on page ${e.page}`);
    for (const id of f.relatedTermIds ?? []) assert.ok(terms.some((t) => t.id === id));
  }
  assert.equal(observed.some((f) => /at will/i.test(f.title)), false, "the observation with no real wording behind it is left out");
  assert.equal(observed.find((f) => /unclear/i.test(f.title))?.needsReview, true);

  const withObservations = summarizeFindings(findings);
  const withoutObservations = summarizeFindings(moneyOnly(findings));
  assert.equal(withObservations.exposureUSD, withoutObservations.exposureUSD);
  for (const f of observed) assert.equal(withObservations.byType[f.type], 0);

  // All money findings come first, so the report's order of amounts is untouched.
  assert.deepEqual(findings, [...moneyOnly(findings), ...observed]);
});

test("a provision outside the 14 money categories cannot influence a money check", async () => {
  const claims = generateSampleClaims();
  const analyzer = new GeminiAnalyzer(makeWire().transport);
  const terms = confirmAll(await analyzer.extractTerms(SAMPLE_PAGES));
  const baseline = moneyOnly(await analyzer.compare(terms, claims, DEFAULT_SETTINGS));
  const unlisted = baseline.find((f) => /Clinical Program Fee/.test(f.title));
  assert.ok(unlisted, "the sample bills a fee the contract does not list");

  // If this provision reached the checks, its wording would make the fee look as if the contract listed it.
  const planted: ContractTerm = {
    id: "ai-999",
    category: "obligation",
    label: "Clinical Program Fee",
    value: 425,
    unit: "USD/month",
    pageRef: 4,
    snippet: "Client shall pay a Clinical Program Fee of $425 per month.",
    confidence: "high",
    confirmed: true,
    origin: "ai",
  };
  const withPlanted = moneyOnly(await analyzer.compare([...terms, planted], claims, DEFAULT_SETTINGS));
  assert.deepEqual(withPlanted, baseline);
});

test("only confirmed terms are used, so an unreviewed Gemini reading checks nothing against the contract", async () => {
  const claims = generateSampleClaims();
  const analyzer = new GeminiAnalyzer(makeWire().transport);
  const terms = await analyzer.extractTerms(SAMPLE_PAGES);
  assert.equal(terms.every((t) => !t.confirmed), true);

  const local = new LocalHeuristicAnalyzer();
  const unconfirmedLocal = (await local.extractTerms(SAMPLE_PAGES)).map((t) => ({ ...t, confirmed: false }));
  assert.deepEqual(moneyOnly(await analyzer.compare(terms, claims, DEFAULT_SETTINGS)), await local.compare(unconfirmedLocal, claims, DEFAULT_SETTINGS));
});

// ---- Failures: a clear error, and never another reader in Gemini's place ----

interface FailureCase {
  name: string;
  code: string;
  retryable: boolean;
  wire?: Parameters<typeof makeWire>[0];
  transport?: AiTransport;
  message?: RegExp;
}

const FAILURES: FailureCase[] = [
  { name: "no session", code: "signed_out", retryable: false, transport: async () => ({ status: 0, body: null, failure: "signed_out" }) },
  { name: "a session the function refuses", code: "signed_out", retryable: false, wire: { token: "expired-token" } },
  {
    name: "the function has not been deployed",
    code: "not_deployed",
    retryable: false,
    transport: async () => ({ status: 404, body: { code: "NOT_FOUND", message: "Requested function was not found" } }),
    message: /extract-contract-terms/,
  },
  {
    // What a browser reports for a missing function: Supabase's "not found" carries no cross-origin headers, so it cannot be read.
    name: "the project answers but the function's answer cannot be read",
    code: "not_deployed",
    retryable: true,
    transport: async () => ({ status: 0, body: null, failure: "no_answer" }),
    message: /most likely not been deployed/,
  },
  {
    name: "the website is not on the function's list of allowed websites",
    code: "forbidden",
    retryable: false,
    wire: { env: { AI_ALLOWED_ORIGINS: "https://somewhere-else.example" } },
    message: /not allowed/,
  },
  { name: "no Gemini key on the server", code: "not_configured", retryable: false, wire: { env: { GEMINI_API_KEY: undefined } } },
  { name: "the placeholder key is still in place", code: "not_configured", retryable: false, wire: { env: { GEMINI_API_KEY: "your-gemini-api-key" } } },
  {
    name: "Gemini rejects the key",
    code: "not_configured",
    retryable: false,
    wire: { answer: () => jsonResponse(403, { error: { code: 403, status: "PERMISSION_DENIED", message: "API key not valid." } }) },
  },
  {
    name: "Gemini does not know the model",
    code: "not_configured",
    retryable: false,
    wire: { answer: () => jsonResponse(404, { error: { code: 404, status: "NOT_FOUND", message: "models/nope is not found" } }) },
  },
  {
    name: "Gemini keeps answering that it is too busy",
    code: "rate_limited",
    retryable: true,
    wire: { answer: () => jsonResponse(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }) },
  },
  { name: "Gemini is down", code: "unavailable", retryable: true, wire: { answer: () => jsonResponse(503, { error: { code: 503, status: "UNAVAILABLE" } }) } },
  { name: "Gemini answers with something that is not the JSON asked for", code: "bad_answer", retryable: true, wire: { answer: () => "I am sorry, I cannot do that." } },
  {
    name: "the network drops",
    code: "offline",
    retryable: true,
    transport: async () => {
      throw new TypeError("Failed to fetch");
    },
  },
  { name: "no answer in time", code: "timeout", retryable: true, transport: async () => ({ status: 0, body: null, failure: "timeout" }) },
  { name: "the platform gives up on the function", code: "timeout", retryable: true, transport: async () => ({ status: 504, body: null }) },
  { name: "a success that cannot be read", code: "bad_answer", retryable: true, transport: async () => ({ status: 200, body: { hello: "world" } }) },
  { name: "a success with a term in a shape the app does not know", code: "bad_answer", retryable: true, transport: async () => ({ status: 200, body: { model: "m", terms: [{ nope: true }], risks: [], stats: {} } }) },
];

for (const c of FAILURES) {
  test(`when ${c.name}, the reading fails with "${c.code}" and nothing is read in its place`, async () => {
    const wire = c.transport ? null : makeWire(c.wire);
    const analyzer = new GeminiAnalyzer(c.transport ?? (wire as NonNullable<typeof wire>).transport);
    const err = await failure(() => analyzer.extractTerms(SAMPLE_PAGES));
    assert.equal(err.code, c.code);
    assert.equal(err.retryable, c.retryable);
    assert.ok(err.message.length > 20, "the message is written for the person using the app");
    assert.doesNotMatch(err.message, /test-gemini-key|Bearer|stack|undefined|\[object/);
    if (c.message) assert.match(err.message, c.message);

    // No terms, no observations, no report: the built-in reader did not step in.
    assert.equal(analyzer.report, null);
    const findings = await analyzer.compare([], generateSampleClaims(), DEFAULT_SETTINGS);
    assert.equal(aiOnly(findings).length, 0);
  });
}

test("cancelling stops the reading and is reported as cancelled, not as a failure of the reader", async () => {
  const wire = makeWire();
  const analyzer = new GeminiAnalyzer(wire.transport);
  const before = new AbortController();
  before.abort();
  assert.equal((await failure(() => analyzer.extractTerms(SAMPLE_PAGES, { signal: before.signal }))).code, "cancelled");
  assert.equal(wire.sent.length, 0, "nothing is sent once the reading has been cancelled");

  // Cancelled while the first of several requests is in flight: the later ones are never sent.
  const during = new AbortController();
  const slow = makeWire();
  const cancelling: AiTransport = async (body, signal) => {
    const result = await slow.transport(body, signal);
    during.abort();
    return result;
  };
  const second = new GeminiAnalyzer(cancelling);
  assert.equal((await failure(() => second.extractTerms(longSample(), { signal: during.signal }))).code, "cancelled");
  assert.equal(slow.sent.length, 1);
});

test("trying again after a failure only asks for the pages that were not read", async () => {
  let failSecond = true;
  const wire = makeWire({
    answer: (pages) => {
      if (failSecond && pages.includes(6)) return jsonResponse(503, { error: { code: 503, status: "UNAVAILABLE" } });
      return sampleModelAnswerFor(pages);
    },
  });
  const analyzer = new GeminiAnalyzer(wire.transport);
  const pages = longSample();
  const batches = splitIntoBatches(pages).map((b) => b.map((p) => p.page));
  const failing = batches.findIndex((b) => b.includes(6));
  assert.ok(failing > 0, "the failing request is not the first one");

  const err = await failure(() => analyzer.extractTerms(pages));
  assert.equal(err.code, "unavailable");
  assert.equal(err.retryable, true);
  assert.deepEqual(wire.sentPages, batches.slice(0, failing + 1));

  failSecond = false;
  const sentBefore = wire.sentPages.length;
  const terms = await analyzer.extractTerms(pages);
  assert.deepEqual(wire.sentPages.slice(sentBefore), batches.slice(failing), "the requests that had succeeded are not sent again");

  const clean = await new GeminiAnalyzer(makeWire().transport).extractTerms(pages);
  assert.deepEqual(terms, clean, "the result is the same as a reading that never failed");
});

test("a different contract starts from nothing, even on the same analyzer", async () => {
  const wire = makeWire();
  const analyzer = new GeminiAnalyzer(wire.transport);
  await analyzer.extractTerms(SAMPLE_PAGES);
  const other = SAMPLE_PAGES.slice(0, 6);
  const terms = await analyzer.extractTerms(other);
  assert.equal(wire.sent.length, 2);
  assert.equal(terms.every((t) => t.pageRef <= 6), true);
  const findings = await analyzer.compare(confirmAll(terms), [], DEFAULT_SETTINGS);
  for (const f of aiOnly(findings)) for (const e of f.evidence) assert.ok(e.page <= 6, "observations from the earlier contract are gone");
});
