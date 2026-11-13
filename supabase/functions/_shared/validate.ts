/**
 * Checks on what comes in from the browser and on what comes back from Gemini.
 * Pure functions: no network, no environment, no logging. Nothing from the model is passed on
 * until it has the right shape, uses the known vocabulary, and quotes wording that is really on
 * the page it names.
 */

import {
  AI_CATEGORY_IDS,
  LEVELS,
  NOTICE_UNITS,
  RISK_KIND_IDS,
  UNIT_CHOICES,
  type Level,
  type NoticeUnit,
} from "./categories.ts";
import { PageIndex, findFigure, isIsoDate, quoteShowsUnit, quoteShowsYear, type PageInput } from "./evidence.ts";
import type { Limits } from "./limits.ts";
import type { AiRisk, AiStats, AiTerm } from "./wire.ts";

// ---- The request ----

/** A request the function will not act on. `status` is the HTTP status to answer with. */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

export type ValidRequest = { task: "status" } | { task: "extract"; pages: PageInput[]; documentPages: number | null };

type Loose = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Throws unless every key of the object is on the list. Keeps anything but page text out, claims rows above all. */
function onlyKeys(value: Loose, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new RequestError(400, "unexpected_field", `Only contract page text is accepted. ${where} has a field that is not allowed.`);
    }
  }
}

/**
 * Checks a request body and returns it in a clean form. Throws RequestError with status 400 for
 * a body of the wrong shape and 413 for one that is over a size limit.
 */
export function validateRequest(body: unknown, limits: Limits): ValidRequest {
  if (!isPlainObject(body)) throw new RequestError(400, "invalid_request", "The request body must be a JSON object.");
  if (body.task === "status") {
    onlyKeys(body, ["task"], "A status request");
    return { task: "status" };
  }
  if (body.task !== "extract") throw new RequestError(400, "invalid_request", 'The request must name a task: "extract" or "status".');
  onlyKeys(body, ["task", "pages", "documentPages"], "The request");

  const { pages } = body;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new RequestError(400, "invalid_request", "The request must hold the text of at least one page.");
  }
  if (pages.length > limits.maxPages) {
    throw new RequestError(413, "too_large", `A request can hold at most ${limits.maxPages} pages.`);
  }

  const clean: PageInput[] = [];
  const seen = new Set<number>();
  let total = 0;
  let hasText = false;
  for (const item of pages as unknown[]) {
    if (!isPlainObject(item)) throw new RequestError(400, "invalid_request", "Each page must be an object with a page number and its text.");
    onlyKeys(item, ["page", "text"], "A page");
    const { page, text } = item;
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > limits.maxPageNumber) {
      throw new RequestError(400, "invalid_request", "Each page needs a whole page number, starting at 1.");
    }
    if (typeof text !== "string") throw new RequestError(400, "invalid_request", "Each page needs its text.");
    if (seen.has(page)) throw new RequestError(400, "invalid_request", "A page number appears twice in the request.");
    if (text.length > limits.maxPageChars) {
      throw new RequestError(413, "too_large", `Page ${page} has more text than the ${limits.maxPageChars} characters allowed for one page.`);
    }
    total += text.length;
    if (total > limits.maxTotalChars) {
      throw new RequestError(413, "too_large", `A request can hold at most ${limits.maxTotalChars} characters of page text.`);
    }
    seen.add(page);
    if (/\S/.test(text)) hasText = true;
    clean.push({ page, text: text.replace(CONTROL_CHARS, " ") });
  }
  if (!hasText) throw new RequestError(400, "no_text", "None of the pages has any text to read.");

  let documentPages: number | null = null;
  if (body.documentPages !== undefined) {
    const n = body.documentPages;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > limits.maxPageNumber) {
      throw new RequestError(400, "invalid_request", "documentPages must be a whole number of pages.");
    }
    documentPages = n;
  }
  return { task: "extract", pages: clean.sort((a, b) => a.page - b.page), documentPages };
}

// ---- The model's answer ----

/** The model answered, but not with something that can be used. The call is worth trying again. */
export class BadModelOutput extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadModelOutput";
  }
}

/** Parses the model's text as JSON. Tolerates a Markdown code fence around it. */
export function parseModelJson(text: string): unknown {
  let body = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fenced) body = fenced[1];
  if (!body) throw new BadModelOutput("empty answer");
  try {
    return JSON.parse(body);
  } catch {
    throw new BadModelOutput("answer is not JSON");
  }
}

export interface Interpreted {
  terms: AiTerm[];
  risks: AiRisk[];
  stats: AiStats;
}

const LABEL_MAX = 120;
const SUMMARY_MAX = 600;
const POINT_MAX = 300;
const POINTS_MAX = 8;
const CLAUSE_MAX = 120;
const CLAUSES_MAX = 10;
const VALUE_TEXT_MAX = 120;
const TITLE_MAX = 160;
const EXPLANATION_MAX = 1_200;
const EVIDENCE_MAX = 4;
const REASON_MAX = 300;

/** One line of tidy text, cut to a length. Anything that is not a string becomes "". */
function tidy(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}\u2026`;
}

function tidyList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = tidy(item, maxLength);
    if (text && !out.includes(text)) out.push(text);
    if (out.length === maxItems) break;
  }
  return out;
}

const isLevel = (v: unknown): v is Level => (LEVELS as readonly unknown[]).includes(v);
const RANK: Record<Level, number> = { high: 3, medium: 2, low: 1 };
const atMost = (level: Level, cap: Level): Level => (RANK[level] <= RANK[cap] ? level : cap);

function cleanRef(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(value) ? value : "";
}

interface CheckedQuote {
  page: number;
  quote: string;
  loose: boolean;
  moved: boolean;
}

/** Checks one quotation. Returns the reason it fails as a string. */
function checkQuote(page: unknown, quote: unknown, index: PageIndex, limits: Limits): CheckedQuote | string {
  if (typeof page !== "number" || !Number.isInteger(page) || typeof quote !== "string") return "malformed";
  if (!index.has(page)) return "page_not_in_request";
  const text = quote.replace(CONTROL_CHARS, " ").trim();
  if (text.replace(/\s+/g, "").length < limits.minQuoteChars) return "quote_too_short";
  if (text.length > limits.maxQuoteChars) return "quote_too_long";
  const match = index.find(text, page);
  if (!match) return "quote_not_found";
  // From here on the quotation is the page's own wording. The model's copy of it is not kept.
  return { page: match.page, quote: match.text, loose: match.level === "loose", moved: match.moved };
}

function formatFigure(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/**
 * Turns the model's parsed answer into checked terms and observations. Items that fail a check
 * are left out and counted by reason. Throws BadModelOutput when the answer as a whole has the
 * wrong shape.
 */
export function interpretModelOutput(data: unknown, pages: readonly PageInput[], limits: Limits): Interpreted {
  if (!isPlainObject(data) || !Array.isArray(data.provisions) || !Array.isArray(data.risks)) {
    throw new BadModelOutput("answer does not have the expected lists");
  }
  const index = new PageIndex(pages);
  const rejected: Record<string, number> = {};
  const reject = (reason: string): void => {
    rejected[reason] = (rejected[reason] ?? 0) + 1;
  };
  let pagesCorrected = 0;
  let termsOverLimit = 0;
  let risksOverLimit = 0;

  // ---- Provisions ----
  const terms: AiTerm[] = [];
  const wantedRefs = new Map<AiTerm, string[]>();
  const usedRefs = new Set<string>();
  const seenTerms = new Set<string>();

  for (const item of data.provisions as unknown[]) {
    if (!isPlainObject(item)) {
      reject("malformed");
      continue;
    }
    if (terms.length >= limits.maxTerms) {
      reject("over_limit");
      termsOverLimit += 1;
      continue;
    }
    const category = item.category;
    if (typeof category !== "string" || !AI_CATEGORY_IDS.includes(category)) {
      reject("unknown_category");
      continue;
    }
    if (typeof item.unit !== "string" || !(UNIT_CHOICES as readonly string[]).includes(item.unit)) {
      reject("unknown_unit");
      continue;
    }
    if (!isLevel(item.confidence)) {
      reject("malformed");
      continue;
    }
    const checked = checkQuote(item.page, item.quote, index, limits);
    if (typeof checked === "string") {
      reject(checked);
      continue;
    }
    const duplicateKey = `${category}|${checked.page}|${checked.quote.toLowerCase()}`;
    if (seenTerms.has(duplicateKey)) {
      reject("duplicate");
      continue;
    }
    seenTerms.add(duplicateKey);
    if (checked.moved) pagesCorrected += 1;

    const reasons: string[] = [];
    let confidence: Level = item.confidence;
    if (checked.loose || checked.moved) confidence = atMost(confidence, "medium");

    // The value: a number when the model gave one, otherwise short text, otherwise nothing.
    let value: AiTerm["value"] = null;
    let unit = item.unit === "none" ? "" : item.unit;
    let valueMatch: string | null = null;
    if (typeof item.value_number === "number" && Number.isFinite(item.value_number)) {
      value = item.value_number;
      valueMatch = findFigure(value, checked.quote);
      if (valueMatch === null) {
        reasons.push(`The figure ${formatFigure(value)} was not found in the quoted wording.`);
        confidence = "low";
      } else if (!quoteShowsUnit(unit, checked.quote)) {
        reasons.push("The quoted wording does not show the unit given for this figure.");
        confidence = atMost(confidence, "medium");
      }
      if (value < 0) reasons.push("The figure is negative.");
    } else {
      const text = tidy(item.value_text, VALUE_TEXT_MAX);
      value = text || null;
      unit = ""; // a unit only makes sense after a number
    }

    const dates: { effectiveDate: string | null; expirationDate: string | null } = { effectiveDate: null, expirationDate: null };
    for (const [field, source] of [
      ["effectiveDate", item.effective_date],
      ["expirationDate", item.expiration_date],
    ] as const) {
      if (source === null || source === undefined || source === "") continue;
      if (typeof source !== "string" || !isIsoDate(source)) {
        reasons.push("A date in this term could not be read and was left out.");
        continue;
      }
      dates[field] = source;
      if (!quoteShowsYear(source, checked.quote)) {
        reasons.push(`The year of the date ${source} was not found in the quoted wording.`);
        confidence = atMost(confidence, "medium");
      }
    }

    let noticePeriod: AiTerm["noticePeriod"] = null;
    if (typeof item.notice_value === "number" && Number.isFinite(item.notice_value) && item.notice_value > 0) {
      if ((NOTICE_UNITS as readonly unknown[]).includes(item.notice_unit)) {
        noticePeriod = { value: item.notice_value, unit: item.notice_unit as NoticeUnit };
        if (findFigure(item.notice_value, checked.quote) === null) {
          reasons.push(`The notice period of ${formatFigure(item.notice_value)} ${item.notice_unit} was not found in the quoted wording.`);
          confidence = atMost(confidence, "medium");
        }
      } else {
        reasons.push("A notice period in this term could not be read and was left out.");
      }
    }

    const modelReason = tidy(item.review_reason, REASON_MAX);
    const modelFlag = item.needs_review === true;
    if (modelFlag) reasons.unshift(modelReason || "The reader was not sure about this term.");

    let ref = cleanRef(item.ref);
    if (!ref || usedRefs.has(ref)) {
      let n = terms.length + 1;
      while (usedRefs.has(`t${n}`)) n += 1;
      ref = `t${n}`;
    }
    usedRefs.add(ref);

    const term: AiTerm = {
      ref,
      category,
      label: tidy(item.label, LABEL_MAX),
      value,
      unit,
      page: checked.page,
      quote: checked.quote,
      valueMatch,
      confidence,
      needsReview: reasons.length > 0,
      reviewReasons: reasons,
      summary: tidy(item.summary, SUMMARY_MAX),
      conditions: tidyList(item.conditions, POINTS_MAX, POINT_MAX),
      exceptions: tidyList(item.exceptions, POINTS_MAX, POINT_MAX),
      effectiveDate: dates.effectiveDate,
      expirationDate: dates.expirationDate,
      noticePeriod,
      relatedClauses: tidyList(item.related_clauses, CLAUSES_MAX, CLAUSE_MAX),
      relatedRefs: [],
    };
    // The model's own ref is what other items point at, even when it had to be replaced here.
    wantedRefs.set(term, Array.isArray(item.related_refs) ? item.related_refs.filter((r): r is string => typeof r === "string") : []);
    terms.push(term);
  }

  // Links are kept only when they point at a provision that passed the checks.
  for (const term of terms) {
    term.relatedRefs = [...new Set(wantedRefs.get(term) ?? [])].filter((r) => r !== term.ref && usedRefs.has(r)).slice(0, 20);
  }

  // ---- Observations ----
  const risks: AiRisk[] = [];
  for (const item of data.risks as unknown[]) {
    if (!isPlainObject(item)) {
      reject("malformed");
      continue;
    }
    if (risks.length >= limits.maxRisks) {
      reject("over_limit");
      risksOverLimit += 1;
      continue;
    }
    const title = tidy(item.title, TITLE_MAX);
    const explanation = tidy(item.explanation, EXPLANATION_MAX);
    if (
      typeof item.kind !== "string" ||
      !RISK_KIND_IDS.includes(item.kind) ||
      !isLevel(item.severity) ||
      !isLevel(item.confidence) ||
      !title ||
      !explanation ||
      !Array.isArray(item.evidence)
    ) {
      reject("malformed");
      continue;
    }
    const evidence: AiRisk["evidence"] = [];
    let firstFailure = "quote_not_found";
    let weak = false;
    for (const e of (item.evidence as unknown[]).slice(0, EVIDENCE_MAX * 2)) {
      if (evidence.length === EVIDENCE_MAX) break;
      const checked = isPlainObject(e) ? checkQuote(e.page, e.quote, index, limits) : "malformed";
      if (typeof checked === "string") {
        if (evidence.length === 0) firstFailure = checked;
        continue;
      }
      if (evidence.some((x) => x.page === checked.page && x.quote === checked.quote)) continue;
      if (checked.moved) pagesCorrected += 1;
      if (checked.loose || checked.moved) weak = true;
      evidence.push({ page: checked.page, quote: checked.quote });
    }
    // An observation with no wording behind it is an opinion, not a finding. It is left out.
    if (evidence.length === 0) {
      reject(firstFailure);
      continue;
    }
    risks.push({
      ref: `r${risks.length + 1}`,
      kind: item.kind,
      severity: item.severity,
      title,
      explanation,
      evidence,
      confidence: weak ? atMost(item.confidence, "medium") : item.confidence,
      needsReview: item.needs_review === true || item.confidence === "low",
      relatedRefs: [
        ...new Set(Array.isArray(item.related_refs) ? item.related_refs.filter((r): r is string => typeof r === "string") : []),
      ]
        .filter((r) => usedRefs.has(r))
        .slice(0, 20),
    });
  }

  return {
    terms,
    risks,
    stats: {
      termsProposed: data.provisions.length,
      termsAccepted: terms.length,
      risksProposed: data.risks.length,
      risksAccepted: risks.length,
      rejected,
      pagesCorrected,
      termsOverLimit,
      risksOverLimit,
      // The model is told to stop at the limit and to put the most material first. An answer that
      // reaches the limit may therefore not hold everything on these pages, and the caller is told.
      termLimitReached: data.provisions.length >= limits.maxTerms,
    },
  };
}
