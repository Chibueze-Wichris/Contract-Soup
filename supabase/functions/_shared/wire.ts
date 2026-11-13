/**
 * What the Edge Function and the web app say to each other. Shared by both, so the two ends
 * cannot drift apart. Types only, plus readers that check a value has the right shape.
 */

import { AI_CATEGORY_IDS, LEVELS, NOTICE_UNITS, RISK_KIND_IDS, type Level, type NoticeUnit } from "./categories.ts";
import type { PageInput } from "./evidence.ts";

/** The only two things the function does. */
export type AiTask = "extract" | "status";

/** A request to read pages. Page text and page numbers are the only content the function accepts. */
export interface ExtractRequestBody {
  task: "extract";
  pages: PageInput[];
  /** How many pages the whole document has, when only some of them are in this request. */
  documentPages?: number;
}

export interface StatusRequestBody {
  task: "status";
}

export type AiRequestBody = ExtractRequestBody | StatusRequestBody;

export interface AiNoticePeriod {
  value: number;
  unit: NoticeUnit;
}

/** One provision, after the function has checked its quotation against the page text. */
export interface AiTerm {
  /** A short handle that other items in the same answer use to point at this one. */
  ref: string;
  category: string;
  label: string;
  value: number | string | null;
  /** One of the app's unit strings, or "" for no unit. */
  unit: string;
  page: number;
  /** Wording copied from that page. Checked: it is really there. */
  quote: string;
  /** The characters in the quotation that state the value, when it has one and it was found. */
  valueMatch: string | null;
  confidence: Level;
  needsReview: boolean;
  reviewReasons: string[];
  summary: string;
  conditions: string[];
  exceptions: string[];
  /** YYYY-MM-DD, or null. */
  effectiveDate: string | null;
  /** YYYY-MM-DD, or null. */
  expirationDate: string | null;
  noticePeriod: AiNoticePeriod | null;
  relatedClauses: string[];
  relatedRefs: string[];
}

/** One observation about risk. Never carries a dollar figure. */
export interface AiRisk {
  ref: string;
  kind: string;
  severity: Level;
  title: string;
  explanation: string;
  evidence: { page: number; quote: string }[];
  confidence: Level;
  needsReview: boolean;
  relatedRefs: string[];
}

export interface AiStats {
  termsProposed: number;
  termsAccepted: number;
  risksProposed: number;
  risksAccepted: number;
  /** How many items were left out, by reason. */
  rejected: Record<string, number>;
  /** Quotations that were found on a different page from the one the model named. */
  pagesCorrected: number;
  /** Items the model sent beyond the most that is kept from one answer. They are counted in `rejected` too. */
  termsOverLimit: number;
  risksOverLimit: number;
  /**
   * True when the model reported as many provisions as one answer may hold. The pages may then
   * hold more than was reported, and the caller should ask again with fewer pages.
   */
  termLimitReached: boolean;
}

export interface ExtractResponseBody {
  model: string;
  terms: AiTerm[];
  risks: AiRisk[];
  stats: AiStats;
}

export interface StatusResponseBody {
  ok: true;
  model: string;
}

export interface AiErrorBody {
  error: {
    code: string;
    message: string;
    /** True when sending the same request again later may work. */
    retryable: boolean;
    requestId: string;
    retryAfterSeconds?: number;
  };
}

// ---- Readers ----

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isTextList = (v: unknown, maxItems: number, maxLength: number): v is string[] =>
  Array.isArray(v) && v.length <= maxItems && v.every((item) => isText(item, maxLength));
const isLevel = (v: unknown): v is Level => (LEVELS as readonly unknown[]).includes(v);
const isPage = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;
const isIsoOrNull = (v: unknown): v is string | null => v === null || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));

const TEXT = 2_000;
const QUOTE = 5_000;
/**
 * A term's name and its value in words. Kept well under what a saved audit allows for them
 * (500 characters in src/lib/auditRecord.ts), so that anything accepted here can be saved and read back.
 */
const NAME = 300;

function readTerm(v: unknown): AiTerm | null {
  if (!isObject(v)) return null;
  const valueOk = v.value === null || (typeof v.value === "number" && Number.isFinite(v.value)) || isText(v.value, NAME);
  const notice = v.noticePeriod;
  const noticeOk =
    notice === null ||
    (isObject(notice) &&
      typeof notice.value === "number" &&
      Number.isFinite(notice.value) &&
      notice.value > 0 &&
      (NOTICE_UNITS as readonly unknown[]).includes(notice.unit));
  if (
    !isText(v.ref, 64) ||
    !isText(v.category, 64) ||
    !AI_CATEGORY_IDS.includes(v.category) ||
    !isText(v.label, NAME) ||
    !valueOk ||
    !isText(v.unit, 32) ||
    !isPage(v.page) ||
    !isText(v.quote, QUOTE) ||
    !(v.valueMatch === null || isText(v.valueMatch, TEXT)) ||
    !isLevel(v.confidence) ||
    typeof v.needsReview !== "boolean" ||
    !isTextList(v.reviewReasons, 20, TEXT) ||
    !isText(v.summary, TEXT) ||
    !isTextList(v.conditions, 50, TEXT) ||
    !isTextList(v.exceptions, 50, TEXT) ||
    !isIsoOrNull(v.effectiveDate) ||
    !isIsoOrNull(v.expirationDate) ||
    !noticeOk ||
    !isTextList(v.relatedClauses, 50, TEXT) ||
    !isTextList(v.relatedRefs, 100, 64)
  ) {
    return null;
  }
  return {
    ref: v.ref,
    category: v.category,
    label: v.label,
    value: v.value as AiTerm["value"],
    unit: v.unit,
    page: v.page,
    quote: v.quote,
    valueMatch: v.valueMatch,
    confidence: v.confidence,
    needsReview: v.needsReview,
    reviewReasons: v.reviewReasons,
    summary: v.summary,
    conditions: v.conditions,
    exceptions: v.exceptions,
    effectiveDate: v.effectiveDate,
    expirationDate: v.expirationDate,
    noticePeriod: notice === null ? null : { value: (notice as Loose).value as number, unit: (notice as Loose).unit as NoticeUnit },
    relatedClauses: v.relatedClauses,
    relatedRefs: v.relatedRefs,
  };
}

function readRisk(v: unknown): AiRisk | null {
  if (!isObject(v)) return null;
  if (
    !isText(v.ref, 64) ||
    !isText(v.kind, 64) ||
    !RISK_KIND_IDS.includes(v.kind) ||
    !isLevel(v.severity) ||
    !isText(v.title, TEXT) ||
    v.title.trim() === "" ||
    !isText(v.explanation, QUOTE) ||
    !Array.isArray(v.evidence) ||
    v.evidence.length === 0 ||
    v.evidence.length > 20 ||
    !isLevel(v.confidence) ||
    typeof v.needsReview !== "boolean" ||
    !isTextList(v.relatedRefs, 100, 64)
  ) {
    return null;
  }
  const evidence: AiRisk["evidence"] = [];
  for (const e of v.evidence as unknown[]) {
    if (!isObject(e) || !isPage(e.page) || !isText(e.quote, QUOTE)) return null;
    evidence.push({ page: e.page, quote: e.quote });
  }
  return {
    ref: v.ref,
    kind: v.kind,
    severity: v.severity,
    title: v.title,
    explanation: v.explanation,
    evidence,
    confidence: v.confidence,
    needsReview: v.needsReview,
    relatedRefs: v.relatedRefs,
  };
}

function readCounts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObject(v)) return out;
  for (const [key, n] of Object.entries(v)) {
    if (/^[a-z_]{1,40}$/.test(key) && typeof n === "number" && Number.isInteger(n) && n >= 0) out[key] = n;
  }
  return out;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

/** Reads the function's answer to an "extract" request. Null when it does not have the right shape. */
export function readExtractResponse(body: unknown): ExtractResponseBody | null {
  if (!isObject(body) || !isText(body.model, 200) || !Array.isArray(body.terms) || !Array.isArray(body.risks)) return null;
  if (body.terms.length > 5_000 || body.risks.length > 5_000) return null;
  const terms: AiTerm[] = [];
  for (const item of body.terms as unknown[]) {
    const term = readTerm(item);
    if (!term) return null;
    terms.push(term);
  }
  const risks: AiRisk[] = [];
  for (const item of body.risks as unknown[]) {
    const risk = readRisk(item);
    if (!risk) return null;
    risks.push(risk);
  }
  const stats = isObject(body.stats) ? body.stats : {};
  return {
    model: body.model,
    terms,
    risks,
    stats: {
      termsProposed: count(stats.termsProposed),
      termsAccepted: count(stats.termsAccepted),
      risksProposed: count(stats.risksProposed),
      risksAccepted: count(stats.risksAccepted),
      rejected: readCounts(stats.rejected),
      pagesCorrected: count(stats.pagesCorrected),
      termsOverLimit: count(stats.termsOverLimit),
      risksOverLimit: count(stats.risksOverLimit),
      termLimitReached: stats.termLimitReached === true,
    },
  };
}

/** Reads the function's answer to a "status" request. */
export function readStatusResponse(body: unknown): StatusResponseBody | null {
  return isObject(body) && body.ok === true && isText(body.model, 200) ? { ok: true, model: body.model } : null;
}

/** Reads an error answer. Null when the body is not one of the function's own errors. */
export function readErrorResponse(body: unknown): AiErrorBody["error"] | null {
  if (!isObject(body) || !isObject(body.error)) return null;
  const e = body.error;
  if (!isText(e.code, 64) || !isText(e.message, TEXT)) return null;
  const retryAfter = typeof e.retryAfterSeconds === "number" && e.retryAfterSeconds > 0 && e.retryAfterSeconds < 86_400 ? e.retryAfterSeconds : undefined;
  return {
    code: e.code,
    message: e.message,
    retryable: e.retryable === true,
    requestId: isText(e.requestId, 64) ? e.requestId : "",
    ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
  };
}
