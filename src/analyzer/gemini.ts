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
  /** Why no answer arrived, when status is 0. */
  failure?: "offline" | "timeout" | "signed_out";
}

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

/** The AI reader could not read the contract. `message` is written for the person using the app. */
export class AiReaderError extends Error {
  constructor(
    readonly code: AiFailureCode,
    message: string,
    /** True when trying again later may work without changing anything. */
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "AiReaderError";
  }
}

export interface AiProgress {
  /** Pages Gemini has finished reading. */
  pagesDone: number;
  /** Pages that have text to read. */
  pagesTotal: number;
}

export interface AiReadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: AiProgress) => void;
}

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
    return new AiReaderError(code, own.message, own.retryable, own.retryAfterSeconds);
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
  /** Finished batches, by position, so that trying again after a failure does not read the same pages twice. */
  private readonly done = new Map<number, BatchResult>();
  /** The pages the finished batches belong to. A different document starts from nothing. */
  private fingerprint = "";
  private observations: HeldObservation[] = [];
  private lastReport: AiReadReport | null = null;

  constructor(private readonly transport: AiTransport) {}

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
    const fingerprint = batches.map((b) => b.map((p) => `${p.page}:${p.text.length}`).join(",")).join("|");
    if (fingerprint !== this.fingerprint) {
      this.done.clear();
      this.fingerprint = fingerprint;
    }
    this.observations = [];
    this.lastReport = null;

    const pagesTotal = batches.reduce((n, b) => n + b.length, 0);
    let pagesDone = 0;
    options.onProgress?.({ pagesDone, pagesTotal });

    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i];
      if (!this.done.has(i)) {
        if (options.signal?.aborted) throw new AiReaderError("cancelled", "Reading was cancelled.", true);
        // PRIVACY: this is everything that leaves the device. Page numbers and page text, nothing else.
        const request: ExtractRequestBody = { task: "extract", pages: batch, documentPages: pages.length };
        let result: AiTransportResult;
        try {
          result = await this.transport(request, options.signal);
        } catch {
          if (options.signal?.aborted) throw new AiReaderError("cancelled", "Reading was cancelled.", true);
          throw new AiReaderError("offline", "The AI reader could not be reached. Check your connection and try again.", true);
        }
        if (options.signal?.aborted) throw new AiReaderError("cancelled", "Reading was cancelled.", true);
        if (result.status !== 200) throw failureFrom(result);
        this.done.set(i, readBatch(result.body, batch));
      }
      pagesDone += batch.length;
      options.onProgress?.({ pagesDone, pagesTotal });
    }

    // Put the batches together. Ids are given here, in page order, so they are the same on every run.
    const results = batches.map((_, i) => this.done.get(i) as BatchResult);
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
    termsLeftOut: Math.max(0, stats.termsProposed - stats.termsAccepted) + unverified,
    observationsLeftOut: Math.max(0, stats.risksProposed - stats.risksAccepted) + unverifiedObservations,
    pagesCorrected: stats.pagesCorrected,
  };
}
