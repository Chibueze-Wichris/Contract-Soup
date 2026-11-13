/**
 * Evidence checks. Pure text work with no network and no model: a quotation either appears in
 * the page text it claims to come from, or it does not.
 *
 * Shared by the Edge Function, which checks every answer from Gemini before it is returned, and
 * by the web app, which checks again against the text it read from the PDF itself.
 */

export interface PageInput {
  page: number;
  text: string;
}

/**
 * Folds away the differences that PDF text extraction and typography introduce, so that the same
 * words compare equal: Unicode forms, curly quotes, the many dash characters, invisible
 * characters, runs of white space, and capital letters.
 */
export function normalizeText(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u0060\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"')
    .normalize("NFKC")
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The normalised text with spaces and hyphens taken out, for words split across lines ("adminis- tration"). */
function loosen(normalized: string): string {
  return normalized.replace(/[\s-]+/g, "");
}

export type MatchLevel = "exact" | "loose";

export interface QuoteMatch {
  /** The page the quotation is actually on. */
  page: number;
  /** "exact": the same words. "loose": the same characters once spacing and hyphens are ignored. */
  level: MatchLevel;
  /** True when the quotation was found on a different page from the one named. */
  moved: boolean;
}

/** The pages of one request, prepared for looking quotations up. */
export class PageIndex {
  private readonly raw = new Map<number, string>();
  private readonly exact = new Map<number, string>();
  private readonly loose = new Map<number, string>();
  /** Page numbers in ascending order. */
  readonly pageNumbers: readonly number[];

  constructor(pages: readonly PageInput[]) {
    for (const p of pages) this.raw.set(p.page, p.text);
    this.pageNumbers = [...this.raw.keys()].sort((a, b) => a - b);
  }

  has(page: number): boolean {
    return this.raw.has(page);
  }

  private exactText(page: number): string {
    let text = this.exact.get(page);
    if (text === undefined) {
      text = normalizeText(this.raw.get(page) ?? "");
      this.exact.set(page, text);
    }
    return text;
  }

  private looseText(page: number): string {
    let text = this.loose.get(page);
    if (text === undefined) {
      text = loosen(this.exactText(page));
      this.loose.set(page, text);
    }
    return text;
  }

  /**
   * Looks for a quotation, first on the page it names and then on the other pages, nearest first.
   * Returns null when the page is not one of the supplied pages or the words are nowhere to be found.
   */
  find(quote: string, namedPage: number): QuoteMatch | null {
    if (!this.has(namedPage)) return null;
    const wanted = normalizeText(quote);
    if (!wanted) return null;
    const wantedLoose = loosen(wanted);
    if (!wantedLoose) return null;

    if (this.exactText(namedPage).includes(wanted)) return { page: namedPage, level: "exact", moved: false };
    if (this.looseText(namedPage).includes(wantedLoose)) return { page: namedPage, level: "loose", moved: false };

    const others = this.pageNumbers
      .filter((p) => p !== namedPage)
      .sort((a, b) => Math.abs(a - namedPage) - Math.abs(b - namedPage) || a - b);
    for (const page of others) if (this.exactText(page).includes(wanted)) return { page, level: "exact", moved: true };
    for (const page of others) if (this.looseText(page).includes(wantedLoose)) return { page, level: "loose", moved: true };
    return null;
  }
}

// ---- Figures ----

interface FoundNumber {
  value: number;
  /** The characters in the text that spell the number. */
  raw: string;
}

const DIGITS = /(?<![\d.,])(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(thousand|million|billion)\b)?/gi;
const SCALE: Record<string, number> = { thousand: 1_000, million: 1_000_000, billion: 1_000_000_000 };

function writtenInDigits(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  for (const m of text.matchAll(DIGITS)) {
    const base = Number((m[2] ?? "").replace(/,/g, "") + (m[3] ?? ""));
    if (!Number.isFinite(base)) continue;
    const scale = m[4] ? (SCALE[m[4].toLowerCase()] ?? 1) : 1;
    out.push({ value: base * scale, raw: m[0].trim() });
    // "$1.5 million" also reads as 1.5, which is how some contracts state a value in a table.
    if (scale !== 1) out.push({ value: base, raw: `${m[1] ?? ""}${m[2] ?? ""}${m[3] ?? ""}`.trim() });
  }
  return out;
}

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

const isCountWord = (w: string): boolean => w in SMALL || w in TENS;

/** Numbers spelled out in words, such as "ninety" or "one hundred and eighty". */
function writtenInWords(text: string): FoundNumber[] {
  const words = [...text.matchAll(/[A-Za-z]+/g)].map((m) => ({ word: m[0].toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const out: FoundNumber[] = [];
  let i = 0;
  while (i < words.length) {
    let total = 0;
    let current = 0;
    let used = 0;
    let last = -1;
    let j = i;
    while (j < words.length) {
      // Number words belong together only when nothing but spaces or a hyphen separates them.
      if (j > i && !/^[\s-]+$/.test(text.slice(words[j - 1].end, words[j].start))) break;
      const w = words[j].word;
      if (w in SMALL) current += SMALL[w];
      else if (w in TENS) current += TENS[w];
      else if (w === "hundred" && current > 0) current *= 100;
      else if ((w === "thousand" || w === "million") && current > 0) {
        total += current * SCALE[w];
        current = 0;
      } else if (w === "and" && used > 0 && j + 1 < words.length && isCountWord(words[j + 1].word)) {
        j += 1;
        continue;
      } else break;
      used += 1;
      last = j;
      j += 1;
    }
    if (used > 0 && last >= i) {
      out.push({ value: total + current, raw: text.slice(words[i].start, words[last].end) });
      i = last + 1;
    } else {
      i += 1;
    }
  }
  return out;
}

const sameNumber = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Looks for a figure in a quotation. Returns the characters that state it ("$24.50", "ninety"),
 * or null when the quotation does not contain that figure. Digits are preferred to words.
 */
export function findFigure(value: number, quote: string): string | null {
  if (!Number.isFinite(value)) return null;
  const wanted = Math.abs(value);
  const digits = writtenInDigits(quote).find((n) => sameNumber(n.value, wanted));
  if (digits) return digits.raw;
  const words = writtenInWords(quote).find((n) => sameNumber(n.value, wanted));
  return words ? words.raw : null;
}

const UNIT_SIGNS: Record<string, RegExp> = {
  USD: /\$|\bdollars?\b|\busd\b|\bcents?\b/i,
  "%": /%|\bper\s?cent\b|\bpercent(?:age)?\b/i,
  days: /\bdays?\b/i,
  months: /\bmonths?\b|\bmonthly\b/i,
  years: /\byears?\b|\bannual(?:ly)?\b|\banniversar/i,
};

/** True when the quotation shows the kind of unit claimed: a dollar sign for USD units, a percent sign for "%", and so on. */
export function quoteShowsUnit(unit: string, quote: string): boolean {
  if (!unit) return true;
  const sign = UNIT_SIGNS[unit.startsWith("USD") ? "USD" : unit];
  return sign ? sign.test(quote) : true;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** True when the year of an ISO date is written in the quotation. */
export function quoteShowsYear(isoDate: string, quote: string): boolean {
  const year = ISO_DATE.exec(isoDate)?.[1];
  return year ? new RegExp(`(?<!\\d)${year}(?!\\d)`).test(quote) : false;
}
