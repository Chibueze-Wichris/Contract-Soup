/**
 * The Gemini reader when Gemini itself is unreliable: a large contract, batches that fail with
 * 503 / 429 / dropped connections and then recover, batches that never recover, and cancellation
 * while waiting to try again.
 *
 * The transport here answers directly, in the shape the Edge Function answers in (its error
 * bodies are read by the same code the app uses), with a clock and a sleep that only record what
 * they were asked for. No test here really waits.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CLIENT_BATCH } from "../supabase/functions/_shared/limits.ts";
import { AiReaderError, GeminiAnalyzer, splitIntoBatches, type AiProgress, type AiTransport, type AiTransportResult } from "../src/analyzer/gemini";
import type { PageText } from "../src/analyzer/types";

/** The sentence every test page states, and the one term an answer reports for it. */
const sentence = (page: number): string => `Page ${page} states that Client shall pay an administrative fee of $10 per employee per month.`;

function pages(count: number, filler = ""): PageText[] {
  return Array.from({ length: count }, (_, i) => ({ page: i + 1, text: `${sentence(i + 1)}${filler}` }));
}

function okResult(batch: readonly PageText[]): AiTransportResult {
  return {
    status: 200,
    body: {
      model: "test-model",
      terms: batch.map((p) => ({
        ref: `t${p.page}`,
        category: "admin_fee",
        label: `Administrative fee ${p.page}`,
        value: 10,
        unit: "USD PEPM",
        page: p.page,
        quote: sentence(p.page),
        valueMatch: "$10",
        confidence: "high",
        needsReview: false,
        reviewReasons: [],
        summary: "Ten dollars per employee per month.",
        conditions: [],
        exceptions: [],
        effectiveDate: null,
        expirationDate: null,
        noticePeriod: null,
        relatedClauses: [],
        relatedRefs: [],
      })),
      risks: [],
      stats: {
        termsProposed: batch.length,
        termsAccepted: batch.length,
        risksProposed: 0,
        risksAccepted: 0,
        rejected: {},
        pagesCorrected: 0,
        termsOverLimit: 0,
        risksOverLimit: 0,
        termLimitReached: false,
      },
    },
  };
}

const errorResult = (status: number, code: string, retryAfterSeconds?: number): AiTransportResult => ({
  status,
  body: {
    error: {
      code,
      message:
        code === "rate_limited"
          ? "Gemini is receiving too many requests right now. Wait a moment and try again."
          : code === "key_rejected"
            ? "Gemini did not accept the server's API key."
            : "Gemini could not be reached or is having problems. Try again shortly.",
      retryable: code !== "key_rejected",
      requestId: "test-request",
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    },
  },
});

interface Harness {
  analyzer: GeminiAnalyzer;
  /** Page numbers of every send, in order. */
  sent: number[][];
  /** Every wait the analyzer asked for, in milliseconds. */
  sleeps: number[];
  progress: AiProgress[];
}

/**
 * An analyzer whose transport follows `script` — given the pages of a send and how many sends
 * have happened, it returns an answer, or null to read the page successfully — and whose waits
 * are recorded, not taken. `sleep` may be replaced to test cancellation mid-wait.
 */
function harness(
  script: (batch: PageText[], send: number) => AiTransportResult | null,
  options: { maxRetries?: number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Harness {
  const sent: number[][] = [];
  const sleeps: number[] = [];
  const progress: AiProgress[] = [];
  const transport: AiTransport = async (body) => {
    const batch = body.task === "extract" ? body.pages : [];
    sent.push(batch.map((p) => p.page));
    return script(batch, sent.length) ?? okResult(batch);
  };
  const analyzer = new GeminiAnalyzer(transport, {
    retryPolicy: { maxRetries: options.maxRetries ?? 3, baseDelayMs: 1_000, maxDelayMs: 30_000, budgetMs: 120_000 },
    sleep:
      options.sleep ??
      (async (ms) => {
        sleeps.push(ms);
      }),
    random: () => 0,
    now: () => 0,
  });
  return { analyzer, sent, sleeps, progress };
}

async function failure(run: () => Promise<unknown>): Promise<AiReaderError> {
  try {
    await run();
  } catch (err) {
    assert.ok(err instanceof AiReaderError, `expected an AiReaderError, got ${String(err)}`);
    return err;
  }
  throw new Error("expected the reading to fail, but it returned");
}

const batchKey = (batch: readonly number[]): string => batch.join(",");

// ---- Test 1: a 298-page contract, read in full ----

test("a 298-page contract is read in valid batches, every page once, and merged in page order", async () => {
  // Pages padded past the sample's size, as 298 pages of real contract would be.
  const doc = pages(298, " Further wording about the services follows here.".repeat(40));
  const { analyzer, sent, progress } = harness(() => null);
  const terms = await analyzer.extractTerms(doc, { onProgress: (p) => progress.push(p) });

  const batches = splitIntoBatches(doc);
  assert.ok(batches.length >= 12, `298 pages need a dozen or so requests, got ${batches.length}`);
  for (const batch of batches) {
    assert.ok(batch.length <= CLIENT_BATCH.maxPages, "no batch holds more pages than the client allows");
    assert.ok(batch.reduce((n, p) => n + p.text.length, 0) <= CLIENT_BATCH.maxChars, "no batch holds more text than the client allows");
  }
  assert.deepEqual(sent, batches.map((b) => b.map((p) => p.page)), "exactly the valid batches, each sent once");
  assert.equal(terms.length, 298, "a term from every page");
  assert.deepEqual(
    terms.map((t) => t.pageRef),
    Array.from({ length: 298 }, (_, i) => i + 1),
    "page numbers stay correct across all batches",
  );
  assert.deepEqual(
    terms.map((t) => t.id),
    terms.map((_, i) => `ai-${i + 1}`),
  );
  assert.equal(analyzer.report?.requests, batches.length);
  assert.equal(progress.at(-1)?.pagesDone, 298);
  assert.equal(progress.at(-1)?.pagesTotal, 298);
});

// ---- Tests 2, 3 and 8: transient 503s are retried as they stand ----

test("one 503 on the second batch: only that batch is asked again, and the reading finishes", async () => {
  const doc = pages(60); // three batches of 25, 25 and 10
  const batches = splitIntoBatches(doc).map((b) => b.map((p) => p.page));
  let failedOnce = false;
  const { analyzer, sent, progress } = harness((batch) => {
    if (!failedOnce && batchKey(batch.map((p) => p.page)) === batchKey(batches[1])) {
      failedOnce = true;
      return errorResult(502, "upstream_unavailable");
    }
    return null;
  });
  const terms = await analyzer.extractTerms(doc, { onProgress: (p) => progress.push(p) });

  assert.equal(terms.length, 60);
  assert.deepEqual(sent, [batches[0], batches[1], batches[1], batches[2]], "batch 1 is not repeated, batch 2 is retried, batch 3 follows");
  const waits = progress.filter((p) => p.phase === "waiting");
  assert.equal(waits.length, 1);
  assert.match(waits[0].message, /temporarily unavailable/);
  assert.match(waits[0].message, /pages 26–50/);
});

test("a batch that fails twice with 503 waits longer each time, and the waits are bounded", async () => {
  const doc = pages(30);
  let failures = 0;
  const { analyzer, sent, sleeps } = harness((batch) => {
    if (batch[0].page === 26 && failures < 2) {
      failures += 1;
      return errorResult(502, "upstream_unavailable");
    }
    return null;
  });
  await analyzer.extractTerms(doc);
  assert.deepEqual(sleeps, [1_000, 2_000], "the backoff doubles; with no jitter it is exact");
  assert.equal(sent.filter((b) => b[0] === 26).length, 3, "two failures and the send that worked");
});

test("a 503 does not split the batch: the same pages are asked for again", async () => {
  const doc = pages(25);
  let failed = false;
  const { analyzer, sent } = harness(() => {
    if (!failed) {
      failed = true;
      return errorResult(503, "upstream_unavailable");
    }
    return null;
  });
  // Answered by the platform itself, in its own shape (503, no function error body): same handling.
  await analyzer.extractTerms(doc);
  assert.deepEqual(sent, [
    Array.from({ length: 25 }, (_, i) => i + 1),
    Array.from({ length: 25 }, (_, i) => i + 1),
  ]);
});

test("Retry-After from the server is waited out in full, from the body or from the header", async () => {
  const fromBody = harness((_batch, send) => (send === 1 ? errorResult(429, "rate_limited", 5) : null));
  await fromBody.analyzer.extractTerms(pages(5));
  assert.deepEqual(fromBody.sleeps, [5_000], "five seconds as asked, not the one-second backoff");

  const fromHeader = harness((_batch, send) =>
    send === 1 ? { status: 429, body: { unexpected: true }, retryAfterSeconds: 7 } : null,
  );
  await fromHeader.analyzer.extractTerms(pages(5));
  assert.deepEqual(fromHeader.sleeps, [7_000]);
});

test("a Retry-After longer than the retry budget is not slept through: the batch gives up and carries the wait", async () => {
  const { analyzer, sent, sleeps } = harness(() => errorResult(429, "rate_limited", 900), { maxRetries: 3 });
  const err = await failure(() => analyzer.extractTerms(pages(5)));
  assert.equal(err.code, "rate_limited");
  assert.equal(err.retryable, true);
  assert.equal(err.retryAfterSeconds, 900, "the person can be told how long Gemini asked for");
  assert.deepEqual(sleeps, [], "no wait was started that the budget could not finish");
  assert.equal(sent.length, 1);
});

test("a dropped connection is retried like an outage", async () => {
  let dropped = false;
  const sent: number[][] = [];
  const analyzer = new GeminiAnalyzer(
    async (body) => {
      const batch = body.task === "extract" ? body.pages : [];
      sent.push(batch.map((p) => p.page));
      if (!dropped) {
        dropped = true;
        throw new TypeError("Failed to fetch");
      }
      return okResult(batch);
    },
    { sleep: async () => undefined, random: () => 0, now: () => 0 },
  );
  const terms = await analyzer.extractTerms(pages(5));
  assert.equal(terms.length, 5);
  assert.equal(sent.length, 2);
});

// ---- Test 4: retries run out ----

test("when every retry fails the reading stops at that batch, keeps what was read, and can resume there", async () => {
  const doc = pages(60);
  const batches = splitIntoBatches(doc).map((b) => b.map((p) => p.page));
  let down = true;
  const { analyzer, sent } = harness(
    (batch) => (down && batch[0].page === 26 ? errorResult(502, "upstream_unavailable") : null),
    { maxRetries: 2 },
  );

  const err = await failure(() => analyzer.extractTerms(doc));
  assert.equal(err.code, "unavailable");
  assert.equal(err.retryable, true);
  assert.deepEqual(err.failedPages, batches[1], "the failed batch is named, page by page");
  assert.equal(err.pagesDone, 25, "the first batch was read and kept");
  assert.equal(err.pagesTotal, 60);
  assert.match(err.message, /Pages 26–50 could not be read/);
  assert.deepEqual(sent, [batches[0], batches[1], batches[1], batches[1]], "one send and two retries of the failed batch, then it stops");
  assert.equal(analyzer.report, null, "a partial reading is never reported as a finished one");

  // Gemini recovers. Asking again sends only what is still owed.
  down = false;
  sent.length = 0;
  const terms = await analyzer.extractTerms(doc);
  assert.deepEqual(sent, [batches[1], batches[2]], "the batch that had succeeded is not sent again");
  assert.equal(terms.length, 60);
});

// ---- Test 5: permanent errors are not retried ----

test("a rejected key is not retried, and neither is a sign-in the function refuses", async () => {
  const key = harness(() => errorResult(502, "key_rejected"));
  const err = await failure(() => key.analyzer.extractTerms(pages(5)));
  assert.equal(err.code, "not_configured");
  assert.equal(err.retryable, false);
  assert.equal(key.sent.length, 1, "asking again unchanged cannot fix a key");

  const signedOut = harness(() => ({ status: 401, body: null }));
  const err2 = await failure(() => signedOut.analyzer.extractTerms(pages(5)));
  assert.equal(err2.code, "signed_out");
  assert.equal(signedOut.sent.length, 1);
});

// ---- Tests 6 and 7: cancellation ----

test("cancelling while waiting for a retry stops the reading: no further send, no later batch", async () => {
  const doc = pages(60);
  const controller = new AbortController();
  const { analyzer, sent, sleeps } = harness((batch) => (batch[0].page === 26 ? errorResult(502, "upstream_unavailable") : null), {
    sleep: async (ms) => {
      sleeps.push(ms);
      controller.abort(); // the person cancels during the wait; the wait then ends at once
    },
  });
  const err = await failure(() => analyzer.extractTerms(doc, { signal: controller.signal }));
  assert.equal(err.code, "cancelled");
  assert.equal(sleeps.length, 1);
  assert.deepEqual(
    sent.map((b) => b[0]),
    [1, 26],
    "the retry never happened and the third batch was never sent",
  );
});

test("cancelling between batches starts no further batch", async () => {
  const controller = new AbortController();
  const { analyzer, sent } = harness(() => null);
  const err = await failure(() =>
    analyzer.extractTerms(pages(60), {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.pagesDone === 25) controller.abort();
      },
    }),
  );
  assert.equal(err.code, "cancelled");
  assert.equal(sent.length, 1);
});

// ---- Test 8: the older split behaviour is unchanged ----

test("an answer cut short still splits the batch, and only then", async () => {
  const doc = pages(12);
  const { analyzer, sent } = harness((batch) =>
    batch.length > 4 ? errorResult(502, "model_output_incomplete") : null,
  );
  const terms = await analyzer.extractTerms(doc);
  assert.equal(terms.length, 12);
  assert.deepEqual(
    sent.map((b) => [b[0], b[b.length - 1]]),
    [
      [1, 12],
      [1, 6],
      [1, 3],
      [4, 6],
      [7, 12],
      [7, 9],
      [10, 12],
    ],
    "halved until each answer fits, with no same-batch retries first",
  );
});

// ---- Test 10: a different document never reuses another's batches ----

test("after a failed reading, a changed document is read from the beginning", async () => {
  const first = pages(30);
  let down = true;
  const { analyzer, sent } = harness((batch) => (down && batch[0].page === 26 ? errorResult(502, "upstream_unavailable") : null), {
    maxRetries: 0,
  });
  await failure(() => analyzer.extractTerms(first));
  assert.equal(sent.length, 2);

  // The same page numbers with different text: nothing from the first document may be reused.
  down = false;
  sent.length = 0;
  const changed = pages(30, " A different agreement entirely, with different wording on every page.");
  const terms = await analyzer.extractTerms(changed);
  assert.equal(terms.length, 30);
  assert.deepEqual(
    sent.map((b) => b[0]),
    [1, 26],
    "both batches were sent for the changed document, including the one that had succeeded before",
  );
});
