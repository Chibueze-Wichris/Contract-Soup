import { AI_CATEGORY_IDS } from "../../supabase/functions/_shared/categories.ts";
import { PageIndex, findFigure } from "../../supabase/functions/_shared/evidence.ts";
import { CLIENT_BATCH, DEFAULT_LIMITS } from "../../supabase/functions/_shared/limits.ts";
import {
  readErrorResponse,
  readExtractResponse,
  type AiRisk,
  type AiTerm,
  type ExtractRequestBody,
} from "../../supabase/functions/_shared/wire.ts";
import { aiFindingType, categoryLabel, isMoneyCategory } from "./categories";
import { runChecks } from "./checks";
import { LOCAL_ANALYZER_VERSION } from "./local";
import type { Analyzer, ClaimRow, ContractTerm, Finding, PageText, Settings, Severity } from "./types";

/**
 * The hybrid analyzer: Gemini reads the contract, TypeScript does the money.
 *
 * extractTerms sends the contract's page text to the `extract-contract-terms` Edge Function,
 * which asks Gemini what the clauses mean and checks every quotation against the page text.
 * The quotations are checked again here, against the text this browser read from the PDF.
 * Every term comes back unconfirmed, for a person to check.
 *
 * compare makes no network call at all. The six money checks in checks.ts run exactly as they
 * do for the built-in reader, on the confirmed terms in the 14 financial categories. Gemini's
 * observations about the wording are then added as findings marked `origin: "ai"`, with no
 * dollar figure, so nothing Gemini said can change a calculated amount or the exposure total.
 *
 * PRIVACY: the only thing this class ever sends is page numbers and page text, and only from
 * extractTerms, which never sees the claims. Claim rows, member identifiers, the file and its
 * name stay on this device. The Gemini API key is not here either: it lives on the server.
 *
 * If Gemini cannot be used, extractTerms throws AiReaderError. It never quietly hands the
 * work to another reader. The caller shows the error and lets the user decide.
 */

export const GEMINI_ANALYZER_VERSION = "gemini-hybrid-1.0.0";

/** What the transport reports back: the HTTP status and the parsed JSON body. Status 0 means no answer arrived. */
export interface AiTransportResult {
  status: number;
  body: unknown;
  /**
   * Why no answer arrived, when status is 0. "no_answer" means the project could be reached but the
   * function's answer could not be read, which is what a browser sees when the function is missing.
   */
  failure?: "offline" | "timeout" | "signed_out" | "no_answer";
  /**
   * The function's `Retry-After` response header, in seconds, when it sent one. The error body can
   * carry the same value; whichever is present is honoured, and neither is ever retried sooner than.
   */
  retryAfterSeconds?: number;
}

/**
 * Said in the audit and in Settings when the project answers but the function's answer cannot be
 * read. A browser hides an answer that lacks cross-origin headers, which is what the platform
 * sends for a function that does not exist, and may send when it turns a request away itself.
 */
export const NO_ANSWER_MESSAGE =
  "The AI reader gave no answer that could be read, although your Supabase project can be reached. Most likely the extract-contract-terms function has not been deployed to it yet. If it has, sign out, sign in again and try once more.";

/** Sends one request to the Edge Function. Passed in, so this file has no dependency on Supabase and can be tested without a network. */
export type AiTransport = (body: ExtractRequestBody, signal?: AbortSignal) => Promise<AiTransportResult>;

export type AiFailureCode =
  | "signed_out"
  | "not_deployed"
  | "not_configured"
  | "forbidden"
  | "rate_limited"
  | "too_large"
  | "offline"
  | "timeout"
  | "unavailable"
  | "bad_answer"
  | "cancelled";

/** Where a reading stopped: the batch that could not be read, and how much was already read and kept. */
export interface AiFailureContext {
  /** Page numbers of the request that failed (the leaf batch, after any splitting). */
  failedPages?: readonly number[];
  /** Pages with text that had been read and kept when the failure stopped the reading. */
  pagesDone?: number;
  /** Pages with text in the whole document. */
  pagesTotal?: number;
  /** How many times the failed request was sent, including the retries inside this reading. */
  attempts?: number;
}

/** The AI reader could not read the contract. `message` is written for the person using the app. */
export class AiReaderError extends Error {
  readonly failedPages?: readonly number[];
  readonly pagesDone?: number;
  readonly pagesTotal?: number;
  readonly attempts?: number;

  constructor(
    readonly code: AiFailureCode,
    message: string,
    /** True when trying again later may work without changing anything. */
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
    context: AiFailureContext = {},
  ) {
    super(message);
    this.name = "AiReaderError";
    this.failedPages = context.failedPages;
    this.pagesDone = context.pagesDone;
    this.pagesTotal = context.pagesTotal;
    this.attempts = context.attempts;
  }
}

export interface AiProgress {
  /** Pages Gemini has finished reading. Only ever counts pages whose answer was checked and kept. */
  pagesDone: number;
  /** Pages that have text to read (blank pages are not sent, and do not count here). */
  pagesTotal: number;
  /** Pages in the whole document, including any blank ones that were not sent. */
  documentPages: number;
  /** What is happening now: a first request, a retry, or the wait before one. */
  phase: "starting" | "reading" | "waiting" | "retrying";
  /** The batch being worked on, as page numbers. */
  batchFirstPage?: number;
  batchLastPage?: number;
  batchIndex?: number;
  batchTotal?: number;
  /** Which send of this batch is in flight or next (1 is the first send). */
  attempt?: number;
  /** How many sends of this batch there may be at most, retries included. */
  maxAttempts?: number;
  /** How long the wait before the next send is, when `phase` is "waiting". */
  retryDelayMs?: number;
  /** The server code behind a wait ("upstream_unavailable", "rate_limited", ...), when known. */
  failureCode?: string;
  /** What is happening, in words a person can follow. */
  message: string;
}

export interface AiReadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AiProgress) => void;
}

/**
 * How a batch that fails for a passing reason (Gemini unavailable, rate limited, a timeout, a
 * dropped connection) is asked for again by this browser, on top of the retries the Edge Function
 * already makes inside one request. Bounded in three ways: a number of retries, a longest wait
 * between them, and a total budget for the whole retry sequence of one batch.
 */
export interface AiRetryPolicy {
  /** Retries after the first send of a batch. 0 turns the frontend retry off. */
  maxRetries: number;
  /** The first wait, in milliseconds. Each later wait doubles, up to `maxDelayMs`. */
  baseDelayMs: number;
  /** The longest wait the backoff itself will ask for. A longer server `Retry-After` is not cut down to this: the batch gives up instead, and says how long the server asked for. */
  maxDelayMs: number;
  /** The longest one batch's retry sequence may take, waits included, in milliseconds. */
  budgetMs: number;
}

export const CLIENT_RETRY: AiRetryPolicy = { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 30_000, budgetMs: 120_000 };

/** Knobs for the analyzer itself. The retry ones exist so tests can run the policy without really waiting. */
export interface GeminiAnalyzerOptions {
  retryPolicy?: Partial<AiRetryPolicy>;
  /** Waits before a retry. Given the signal, so a wait can be cut short. Defaults to a real, cancellable wait. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Source of the jitter added to each wait, returning 0 to 1. Defaults to Math.random. */
  random?: () => number;
  /** The clock the retry budget is measured on. Defaults to Date.now. */
  now?: () => number;
}

const clampPolicy = (partial: Partial<AiRetryPolicy> = {}): AiRetryPolicy => {
  const pick = (value: number | undefined, fallback: number, min: number, max: number): number =>
    typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
  return {
    maxRetries: pick(partial.maxRetries, CLIENT_RETRY.maxRetries, 0, 10),
    baseDelayMs: pick(partial.baseDelayMs, CLIENT_RETRY.baseDelayMs, 0, 600_000),
    maxDelayMs: pick(partial.maxDelayMs, CLIENT_RETRY.maxDelayMs, 0, 600_000),
    budgetMs: pick(partial.budgetMs, CLIENT_RETRY.budgetMs, 0, 3_600_000),
  };
};

/** A wait that stops as soon as the reading is cancelled, and says so by rejecting. */
const cancellableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** What happened during a reading, for the review screen. Counts only. */
export interface AiReadReport {
  /** The model that read the contract, as the server reports it. */
  model: string;
  /** Provisions Gemini proposed that failed a check and were left out. */
  termsLeftOut: number;
  /** Observations Gemini proposed that failed a check and were left out. */
  observationsLeftOut: number;
  /** Observations that passed and will be added to the report. */
  observations: number;
  /** Quotations that were on a different page from the one Gemini named, and were put right. */
  pagesCorrected: number;
  /**
   * Pages for which Gemini reported as many terms as one answer may hold, even when asked about
   * that page alone. Such a page may hold more terms than were reported.
   */
  pagesAtLimit: number[];
  /** How many requests the reading took. More than the contract's size suggests when dense pages were asked about again. */
  requests: number;
}

interface HeldObservation {
  severity: Severity;
  kind: string;
  title: string;
  explanation: string;
  evidence: { page: number; snippet: string }[];
  confidence: Severity;
  needsReview: boolean;
  relatedTermIds: string[];
}

interface BatchResult {
  model: string;
  terms: ContractTerm[];
  observations: HeldObservation[];
  termsLeftOut: number;
  observationsLeftOut: number;
  pagesCorrected: number;
  /** Gemini reported as many terms as one answer may hold, so these pages may hold more. */
  atTermLimit: boolean;
  /** The page numbers the request held. */
  pages: number[];
}

/** What is known about one request's pages: its checked answer, or that they must be asked about in two halves, and why. */
type Held = BatchResult | "split" | "split-time";

/**
 * What a failed request should lead to. The distinction that matters most: a Gemini 503 (and its
 * neighbours) is the service being unavailable, not evidence that the request held too many pages,
 * so it is asked for again as it stands. Only the two older signals split a batch:
 *   "size"  the answer was cut off because it grew too long: asking again for the same pages cannot work
 *   "time"  no answer came in time: fewer pages take less time, but Gemini may also just be slow today,
 *           so the same batch is retried first and only halved when retrying it has not helped
 * Everything else that may pass ("transient": unavailable, rate limited, a dropped connection) is
 * retried as it stands and never halved. The rest is "permanent" for this reading: retrying the
 * same request unchanged cannot fix a key, a sign-in, a model name or a malformed answer, so it
 * stops at once and says why. (Trying again by hand later stays possible whenever the error says
 * it is retryable; that is a separate, human decision.)
 */
type FailureAction = "size" | "time" | "transient" | "permanent";

interface FailureKind {
  action: FailureAction;
  /** The function's own error code, when it sent one. */
  code: string | null;
  /** How long the server asked us to wait, in seconds (error body first, then the response header). */
  retryAfterSeconds: number | null;
}

function failureKind(result: AiTransportResult): FailureKind {
  const own = result.status === 0 ? null : readErrorResponse(result.body);
  const retryAfterSeconds = own?.retryAfterSeconds ?? result.retryAfterSeconds ?? null;
  if (result.status === 0) {
    // A thrown network error arrives here as an "offline" result made by the caller.
    if (result.failure === "timeout") return { action: "time", code: "upstream_timeout", retryAfterSeconds };
    if (result.failure === "offline" || result.failure === undefined) return { action: "transient", code: "network", retryAfterSeconds };
    return { action: "permanent", code: result.failure, retryAfterSeconds };
  }
  if (own) {
    if (own.code === "model_output_incomplete") return { action: "size", code: own.code, retryAfterSeconds };
    if (own.code === "upstream_timeout") return { action: "time", code: own.code, retryAfterSeconds };
    if (own.code === "upstream_unavailable" || own.code === "rate_limited" || own.code === "auth_unavailable")
      return { action: "transient", code: own.code, retryAfterSeconds };
    return { action: "permanent", code: own.code, retryAfterSeconds };
  }
  // Answered by the platform in front of the function, in its own shape.
  if (result.status === 429) return { action: "transient", code: "rate_limited", retryAfterSeconds };
  if (result.status === 504 || result.status === 546) return { action: "time", code: "upstream_timeout", retryAfterSeconds };
  if (result.status === 502 || result.status === 503) return { action: "transient", code: "upstream_unavailable", retryAfterSeconds };
  return { action: "permanent", code: null, retryAfterSeconds };
}

/** "pages 101–125", or "page 7". The failed batch as a person would name it. */
function pageRange(pages: readonly PageText[]): string {
  if (pages.length === 0) return "the contract";
  const first = pages[0].page;
  const last = pages[pages.length - 1].page;
  return first === last ? `page ${first}` : `pages ${first}–${last}`;
}

/** A short, stable mark of a page's text, so that a changed page is never mistaken for one already read. */
function textMark(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length}.${(h >>> 0).toString(36)}`;
}

/** Splits the pages that have text into requests the server will accept. Blank pages are not sent. */
export function splitIntoBatches(pages: readonly PageText[]): PageText[][] {
  const batches: PageText[][] = [];
  let current: PageText[] = [];
  let chars = 0;
  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    if (!/\S/.test(page.text)) continue;
    if (page.text.length > DEFAULT_LIMITS.maxPageChars) {
      throw new AiReaderError(
        "too_large",
        `Page ${page.page} has more text than the AI reader can take in one page. Use the built-in reader for this contract.`,
        false,
      );
    }
    if (current.length > 0 && (current.length >= CLIENT_BATCH.maxPages || chars + page.text.length > CLIENT_BATCH.maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push({ page: page.page, text: page.text });
    chars += page.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Turns an answer that is not a success into an error the user can act on. */
function failureFrom(result: AiTransportResult): AiReaderError {
  const { status } = result;
  if (status === 0) {
    if (result.failure === "signed_out") return new AiReaderError("signed_out", "You are signed out. Sign in again to use the AI reader.", false);
    if (result.failure === "timeout") return new AiReaderError("timeout", "The AI reader took too long to answer. Try again.", true);
    // The cause is a guess, so asking again stays possible: it works as soon as the function is deployed.
    if (result.failure === "no_answer") return new AiReaderError("not_deployed", NO_ANSWER_MESSAGE, true);
    return new AiReaderError("offline", "The AI reader could not be reached. Check your connection and try again.", true);
  }
  // The function's own errors carry a message written for the user.
  const own = readErrorResponse(result.body);
  if (own) {
    const code: AiFailureCode =
      own.code === "not_configured" || own.code === "key_rejected" || own.code === "model_unavailable" || own.code === "precondition_failed"
        ? "not_configured"
        : own.code === "unauthorized"
          ? "signed_out"
          : own.code === "forbidden" || own.code === "origin_not_allowed"
            ? "forbidden"
            : own.code === "rate_limited"
              ? "rate_limited"
              : own.code === "too_large"
                ? "too_large"
                : own.code === "upstream_timeout"
                  ? "timeout"
                  : own.code === "bad_model_output" || own.code === "model_output_incomplete"
                    ? "bad_answer"
                    : "unavailable";
    return new AiReaderError(code, own.message, own.retryable, own.retryAfterSeconds ?? result.retryAfterSeconds);
  }
  // Anything else was answered by the platform in front of the function, not by the function.
  if (status === 401 || status === 403) return new AiReaderError("signed_out", "Your sign-in is no longer valid. Sign in again to use the AI reader.", false);
  if (status === 404) {
    return new AiReaderError(
      "not_deployed",
      "The AI reader has not been set up on this Supabase project yet: the extract-contract-terms function was not found.",
      false,
    );
  }
  if (status === 413) return new AiReaderError("too_large", "This contract has more text than the AI reader accepts in one request.", false);
  if (status === 429) return new AiReaderError("rate_limited", "The AI reader is receiving too many requests. Wait a moment and try again.", true);
  if (status === 504 || status === 546) return new AiReaderError("timeout", "The AI reader took too long to answer. Try again.", true);
  return new AiReaderError("unavailable", "The AI reader is not working right now. Try again shortly.", true);
}

const RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

/**
 * The most one reading may hold. Far above what a real contract gives, and under what a saved
 * audit accepts (src/lib/auditRecord.ts), so a reading that succeeds can always be saved.
 */
export const MAX_AI_TERMS = 4_000;
export const MAX_AI_OBSERVATIONS = 2_000;

export class GeminiAnalyzer implements Analyzer {
  /**
   * What has been learned so far, by the page numbers of each request. Trying again after a
   * failure then asks only for what is still missing, and does not repeat a request that is
   * already known to hold too much.
   */
  private readonly done = new Map<string, Held>();
  /** The pages the held answers belong to. A different document starts from nothing. */
  private fingerprint = "";
  private observations: HeldObservation[] = [];
  private lastReport: AiReadReport | null = null;

  private readonly retryPolicy: AiRetryPolicy;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(
    private readonly transport: AiTransport,
    options: GeminiAnalyzerOptions = {},
  ) {
    this.retryPolicy = clampPolicy(options.retryPolicy);
    this.sleep = options.sleep ?? cancellableSleep;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  /** Recorded on the audit. Names the model once it is known, and the local checks that did the arithmetic. */
  get version(): string {
    const model = this.lastReport?.model;
    return `${GEMINI_ANALYZER_VERSION}${model ? ` (${model})` : ""} + ${LOCAL_ANALYZER_VERSION}`;
  }

  /** What the last reading left out and added. Null until a reading has finished. */
  get report(): AiReadReport | null {
    return this.lastReport;
  }

  async extractTerms(pages: PageText[], options: AiReadOptions = {}): Promise<ContractTerm[]> {
    const batches = splitIntoBatches(pages);
    const fingerprint = batches.map((b) => b.map((p) => `${p.page}:${textMark(p.text)}`).join(",")).join("|");
    if (fingerprint !== this.fingerprint) {
      this.done.clear();
      this.fingerprint = fingerprint;
    }
    // A batch remembered as split for time is only "already halved" within the reading that
    // halved it. On a fresh try its halves may be halved once more: Gemini may be slower still,
    // and each time the person asks again, one more halving is allowed.
    for (const [key, held] of this.done) if (held === "split-time") this.done.set(key, "split");
    this.observations = [];
    this.lastReport = null;

    const pagesTotal = batches.reduce((n, b) => n + b.length, 0);
    let pagesDone = 0;
    let requests = 0;

    const cancelled = (): AiReaderError => new AiReaderError("cancelled", "Reading was cancelled.", true);
    if (options.signal?.aborted) throw cancelled();

    const reportProgress = (partial: Omit<AiProgress, "pagesDone" | "pagesTotal" | "documentPages">): void => {
      options.onProgress?.({ pagesDone, pagesTotal, documentPages: pages.length, ...partial });
    };
    reportProgress({
      phase: "starting",
      message: pagesTotal === pages.length ? "Gemini is reading the contract." : `Gemini is reading the contract. Blank pages are not sent, so ${pagesTotal} of ${pages.length} pages have text to read.`,
    });

    /** Names the batch a failure belongs to, and how much has already been read and kept. Never holds the cause twice. */
    const withContext = (err: AiReaderError, batch: PageText[], attempts: number): AiReaderError => {
      if (err.code === "cancelled" || err.failedPages !== undefined) return err;
      return new AiReaderError(
        err.code,
        `${err.message} ${pageRange(batch).replace(/^p/, "P")} could not be read.`,
        err.retryable,
        err.retryAfterSeconds,
        { failedPages: batch.map((p) => p.page), pagesDone, pagesTotal, attempts },
      );
    };

    /**
     * Sends one batch, asking again after a passing failure. Returns the checked answer, or
     * "split" when the batch must be asked about in two halves. A failure that asking again
     * cannot fix, and one whose retries run out, is thrown with the batch named on it.
     *
     * Only a checked answer is ever stored in `done`. A failed send stores nothing, so asking
     * again later — in this reading after a wait, or when the person retries — sends exactly
     * this batch again and no batch that already succeeded.
     */
    const sendBatch = async (batch: PageText[], halvedForTime: boolean, batchIndex: number): Promise<Held> => {
      // PRIVACY: this is everything that leaves the device. Page numbers and page text, nothing else.
      const request: ExtractRequestBody = { task: "extract", pages: batch, documentPages: pages.length };
      const policy = this.retryPolicy;
      const maxAttempts = 1 + policy.maxRetries;
      const startedAt = this.now();
      let attempt = 0;

      for (;;) {
        if (options.signal?.aborted) throw cancelled();
        attempt += 1;
        requests += 1;
        reportProgress({
          phase: attempt === 1 ? "reading" : "retrying",
          batchFirstPage: batch[0]?.page,
          batchLastPage: batch[batch.length - 1]?.page,
          batchIndex,
          batchTotal: batches.length,
          attempt,
          maxAttempts,
          message:
            attempt === 1
              ? `Processing ${pageRange(batch)} of ${pages.length}.`
              : `Trying ${pageRange(batch)} again (attempt ${attempt} of ${maxAttempts}).`,
        });

        let result: AiTransportResult;
        try {
          result = await this.transport(request, options.signal);
        } catch {
          if (options.signal?.aborted) throw cancelled();
          // A transport that throws has no answer to classify: that is a connection that dropped.
          result = { status: 0, body: null, failure: "offline" };
        }
        if (options.signal?.aborted) throw cancelled();

        if (result.status === 200) {
          let answer: BatchResult;
          try {
            answer = readBatch(result.body, batch);
          } catch (err) {
            if (err instanceof AiReaderError) throw withContext(err, batch, attempt);
            throw err;
          }
          // At the limit with several pages: what was left unreported cannot be known, so the answer is not used.
          return answer.atTermLimit && batch.length > 1 ? "split" : answer;
        }

        const kind = failureKind(result);
        if (kind.action === "size") {
          if (batch.length > 1) return "split";
          throw withContext(failureFrom(result), batch, attempt); // one page cannot be halved, and asking again cannot shorten its answer
        }
        if (kind.action === "permanent") throw withContext(failureFrom(result), batch, attempt);

        // Passing failure. A batch that was already halved for time and still gets no answer in
        // time is not halved again in this reading: the pages are unlikely to be the cause.
        const maySplitForTime = kind.action === "time" && batch.length > 1 && !halvedForTime;
        if (attempt >= maxAttempts) {
          if (maySplitForTime) return "split-time";
          throw withContext(failureFrom(result), batch, attempt);
        }

        // The wait: our own doubling backoff with jitter, but never shorter than the server's
        // Retry-After. A wait that cannot fit in what is left of the budget is not slept through
        // in part: the batch gives up now, carrying the server's wait on the error, so the
        // person is told honestly how long Gemini asked for.
        const backoff = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
        const jitter = Math.floor(Math.max(0, Math.min(1, this.random())) * Math.min(250, backoff / 4));
        const retryAfterMs = (kind.retryAfterSeconds ?? 0) * 1_000;
        const waitMs = Math.max(backoff + jitter, retryAfterMs);
        if (waitMs > policy.budgetMs - (this.now() - startedAt)) {
          if (maySplitForTime) return "split-time";
          throw withContext(failureFrom(result), batch, attempt);
        }
        reportProgress({
          phase: "waiting",
          batchFirstPage: batch[0]?.page,
          batchLastPage: batch[batch.length - 1]?.page,
          batchIndex,
          batchTotal: batches.length,
          attempt: attempt + 1,
          maxAttempts,
          retryDelayMs: waitMs,
          ...(kind.code ? { failureCode: kind.code } : {}),
          message: `Gemini is temporarily unavailable. Retrying ${pageRange(batch)} in ${Math.max(1, Math.round(waitMs / 1_000))} seconds (retry ${attempt} of ${policy.maxRetries}). ${pagesDone} of ${pagesTotal} pages read so far.`,
        });
        try {
          await this.sleep(waitMs, options.signal);
        } catch {
          if (options.signal?.aborted) throw cancelled();
          throw cancelled();
        }
        if (options.signal?.aborted) throw cancelled();
      }
    };

    /**
     * Reads these pages, in as many requests as it takes.
     *
     * One answer holds a limited number of terms and must arrive within a time limit. When a
     * request turns out to hold more than that allows, its pages are asked about again in two
     * halves, so a dense contract is read in full instead of losing its less prominent terms.
     * An unavailable Gemini ("transient", and a timeout that retrying did not cure in a batch
     * already halved for time) never splits a batch: the same pages are asked for again, and
     * only this batch, until its retries run out.
     *
     * `halvedForTime` says these pages are already half of a request that got no answer in time.
     * If they get none either, the cause is more likely Gemini than the pages, and the reading
     * stops there. Each time the person asks again, one more halving is allowed.
     */
    const read = async (batch: PageText[], halvedForTime: boolean, batchIndex: number): Promise<BatchResult[]> => {
      const key = batch.map((p) => p.page).join(",");
      let held = this.done.get(key);

      if (held === undefined) {
        held = await sendBatch(batch, halvedForTime, batchIndex);
        // A split is remembered too, so a later try does not send a batch already known to hold too much.
        // A thrown failure remembers nothing: that batch is still owed.
        this.done.set(key, held);
      }

      if (held === "split" || held === "split-time") {
        const middle = Math.ceil(batch.length / 2);
        // Only the halves of a time split count as already halved for time. (At the term limit
        // `sendBatch` returns a plain "split": the limit says nothing about how long pages take.)
        const halvesForTime = held === "split-time";
        return [
          ...(await read(batch.slice(0, middle), halvesForTime, batchIndex)),
          ...(await read(batch.slice(middle), halvesForTime, batchIndex)),
        ];
      }
      pagesDone += batch.length;
      reportProgress({
        phase: "reading",
        batchFirstPage: batch[0]?.page,
        batchLastPage: batch[batch.length - 1]?.page,
        batchIndex,
        batchTotal: batches.length,
        message:
          pagesDone >= pagesTotal ? `All ${pagesTotal} pages with text have been read.` : `Successfully read ${pagesDone} of ${pagesTotal} pages so far.`,
      });
      return [held];
    };

    const results: BatchResult[] = [];
    for (let i = 0; i < batches.length; i += 1) results.push(...(await read(batches[i], false, i + 1)));

    // Put the answers together. Ids are given here, in page order, so they are the same on every run.
    const terms: ContractTerm[] = [];
    const observations: HeldObservation[] = [];
    results.forEach((result, batchIndex) => {
      const rename = (ref: string): string => `ai-b${batchIndex + 1}-${ref}`;
      for (const term of result.terms) {
        terms.push({
          ...term,
          id: rename(term.id),
          ...(term.relatedTermIds ? { relatedTermIds: term.relatedTermIds.map(rename) } : {}),
        });
      }
      for (const o of result.observations) observations.push({ ...o, relatedTermIds: o.relatedTermIds.map(rename) });
    });

    if (terms.length > MAX_AI_TERMS || observations.length > MAX_AI_OBSERVATIONS) {
      throw new AiReaderError(
        "too_large",
        "The AI reader found more in this contract than one audit can hold. Split the contract into parts, or use the built-in reader.",
        false,
      );
    }

    terms.sort((a, b) => a.pageRef - b.pageRef);
    const finalIds = new Map(terms.map((t, i) => [t.id, `ai-${i + 1}`]));
    const finalId = (id: string): string => finalIds.get(id) ?? id;
    const finished = terms.map((t) => ({
      ...t,
      id: finalId(t.id),
      ...(t.relatedTermIds ? { relatedTermIds: t.relatedTermIds.map(finalId) } : {}),
    }));

    this.observations = observations.map((o) => ({ ...o, relatedTermIds: o.relatedTermIds.map(finalId) }));
    this.lastReport = {
      model: results[0]?.model ?? "",
      termsLeftOut: results.reduce((n, r) => n + r.termsLeftOut, 0),
      observationsLeftOut: results.reduce((n, r) => n + r.observationsLeftOut, 0),
      observations: this.observations.length,
      pagesCorrected: results.reduce((n, r) => n + r.pagesCorrected, 0),
      // Only single pages can be left here: a request of several pages at the limit is always asked again in halves.
      pagesAtLimit: results.filter((r) => r.atTermLimit).flatMap((r) => r.pages),
      requests,
    };
    return finished;
  }

  async compare(terms: ContractTerm[], claims: ClaimRow[], settings: Settings): Promise<Finding[]> {
    // The money: the same deterministic checks as the built-in reader, on the 14 financial categories only.
    // PRIVACY: `claims` goes to runChecks and nowhere else. Nothing in this method touches the network.
    const money = runChecks(
      terms.filter((t) => isMoneyCategory(t.category)),
      claims,
      settings,
    );

    // The reading: what Gemini noticed in the wording. No amount, so no effect on any total.
    const known = new Set(terms.map((t) => t.id));
    const observed: Finding[] = this.observations
      .map((o, i) => ({ o, i }))
      .sort((a, b) => RANK[b.o.severity] - RANK[a.o.severity] || a.i - b.i)
      .map(({ o }, position): Finding => {
        const related = o.relatedTermIds.filter((id) => known.has(id));
        return {
          id: `f-ai-${position + 1}`,
          severity: o.severity,
          type: aiFindingType(o.kind),
          title: o.title,
          explanation: o.explanation,
          estimatedImpactUSD: null,
          evidence: o.evidence.map((e) => ({ page: e.page, snippet: e.snippet })),
          status: "open",
          origin: "ai",
          confidence: o.confidence,
          ...(o.needsReview ? { needsReview: true } : {}),
          ...(related.length > 0 ? { relatedTermIds: related } : {}),
        };
      });

    return [...money, ...observed];
  }
}

// ---- Reading one answer from the Edge Function ----

/** `wording` is the quotation as this browser's copy of the page has it. It is what the reviewer is shown. */
function toTerm(t: AiTerm, wording: string): ContractTerm {
  const reasons = [...t.reviewReasons];
  let confidence = t.confidence;
  // The server makes this check too. It is repeated here so that a figure is never trusted on the server's word alone.
  const figure = typeof t.value === "number" ? findFigure(t.value, wording) : null;
  const quoteStatesValue = typeof t.value !== "number" || figure !== null;
  if (typeof t.value === "number" && !quoteStatesValue && !reasons.some((r) => /not found in the quoted wording/.test(r))) {
    reasons.push(`The figure ${t.value.toLocaleString("en-US", { maximumFractionDigits: 6 })} was not found in the quoted wording.`);
    confidence = "low";
  }
  const needsReview = t.needsReview || reasons.length > 0;
  return {
    id: t.ref,
    category: t.category,
    label: t.label.trim() || categoryLabel(t.category),
    value: t.value,
    // A unit only makes sense after a number. The review screen says so too.
    unit: typeof t.value === "number" ? t.unit : "",
    pageRef: t.page,
    snippet: wording,
    confidence,
    confirmed: false, // always: a person confirms every term the AI reader finds
    ...(figure !== null ? { match: figure } : {}),
    origin: "ai",
    ...(t.summary ? { summary: t.summary } : {}),
    ...(t.conditions.length > 0 ? { conditions: t.conditions } : {}),
    ...(t.exceptions.length > 0 ? { exceptions: t.exceptions } : {}),
    ...(t.effectiveDate ? { effectiveDate: t.effectiveDate } : {}),
    ...(t.expirationDate ? { expirationDate: t.expirationDate } : {}),
    ...(t.noticePeriod ? { noticePeriod: t.noticePeriod } : {}),
    ...(t.relatedClauses.length > 0 ? { relatedClauses: t.relatedClauses } : {}),
    ...(t.relatedRefs.length > 0 ? { relatedTermIds: t.relatedRefs } : {}),
    ...(needsReview ? { needsReview: true, reviewReasons: reasons.length > 0 ? reasons : ["The reader was not sure about this term."] } : {}),
  };
}

/**
 * Reads the function's answer for one batch and checks it against the page text held here.
 * A quotation that is not on its page is dropped even though the server passed it.
 */
function readBatch(body: unknown, pages: readonly PageText[]): BatchResult {
  const answer = readExtractResponse(body);
  if (!answer) throw new AiReaderError("bad_answer", "The AI reader sent back something that could not be read. Try again.", true);

  const index = new PageIndex(pages);
  /** The wording as this browser's copy of the page has it, or null when it is not on that page. */
  const wordingOn = (page: number, quote: string): string | null => {
    const match = index.find(quote, page);
    return match !== null && !match.moved ? match.text : null;
  };

  const terms: ContractTerm[] = [];
  let unverified = 0;
  for (const t of answer.terms) {
    const wording = AI_CATEGORY_IDS.includes(t.category) ? wordingOn(t.page, t.quote) : null;
    if (wording === null) {
      unverified += 1;
      continue;
    }
    terms.push(toTerm(t, wording));
  }
  const kept = new Set(terms.map((t) => t.id));
  for (const term of terms) {
    const related = term.relatedTermIds?.filter((id) => kept.has(id) && id !== term.id) ?? [];
    if (related.length > 0) term.relatedTermIds = related;
    else delete term.relatedTermIds;
  }

  const observations: HeldObservation[] = [];
  let unverifiedObservations = 0;
  for (const r of answer.risks as AiRisk[]) {
    const evidence = r.evidence.flatMap((e) => {
      const wording = wordingOn(e.page, e.quote);
      return wording === null ? [] : [{ page: e.page, snippet: wording }];
    });
    if (evidence.length === 0) {
      unverifiedObservations += 1;
      continue;
    }
    observations.push({
      severity: r.severity,
      kind: r.kind,
      title: r.title,
      explanation: r.explanation,
      evidence,
      confidence: r.confidence,
      needsReview: r.needsReview,
      relatedTermIds: r.relatedRefs.filter((ref) => kept.has(ref)),
    });
  }

  const { stats } = answer;
  return {
    model: answer.model,
    terms,
    observations,
    // Left out means "failed a check". A repeat of a term already reported, or an item beyond the most one
    // answer may hold, is not that: the first is no loss, and the second is reported through atTermLimit.
    termsLeftOut: Math.max(0, stats.termsProposed - stats.termsAccepted - (stats.rejected.duplicate ?? 0) - stats.termsOverLimit) + unverified,
    observationsLeftOut: Math.max(0, stats.risksProposed - stats.risksAccepted - stats.risksOverLimit) + unverifiedObservations,
    pagesCorrected: stats.pagesCorrected,
    atTermLimit: stats.termLimitReached,
    pages: pages.map((p) => p.page),
  };
}
