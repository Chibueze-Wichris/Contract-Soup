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

const APOSTROPHES = /[\u2018\u2019\u201A\u201B\u2032\u0060\u00B4]/g;
const QUOTE_MARKS = /[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g;
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const WHITE_SPACE = /\s/;
/**
 * One character together with the accents that follow it. Invisible characters among them belong
 * to the same piece, so that taking them out cannot leave an accent stranded.
 */
const CLUSTER = /[\s\S][\p{M}\u00AD\u200B-\u200D\u2060\uFEFF]*/uy;

/** The folding applied to one cluster. Applied piece by piece, so that every folded character can be traced to its source. */
function foldCluster(cluster: string): string {
  return cluster
    .replace(INVISIBLE, "")
    .replace(APOSTROPHES, "'")
    .replace(QUOTE_MARKS, '"')
    .normalize("NFKC")
    .replace(DASHES, "-")
    .replace(CONTROLS, " ")
    .toLowerCase()
    .normalize("NFKC"); // again: lower case can leave accents in an order the first pass would not have
}

/** What each plain ASCII character folds to. The common case, so it is a table lookup. */
const ASCII: string[] = Array.from({ length: 128 }, (_, code) => {
  if (code <= 0x20 || code === 0x7f) return " ";
  if (code === 0x60) return "'";
  return String.fromCharCode(code).toLowerCase();
});

interface Folded {
  /** The folded text. */
  text: string;
  /** For each character of `text`, where the piece of the source it came from starts. Empty unless asked for. */
  from: number[];
  /** For each character of `text`, where the piece of the source it came from ends. */
  to: number[];
}

/**
 * Folds away the differences that PDF text extraction and typography introduce, so that the same
 * words compare equal: Unicode forms, curly quotes, the many dash characters, invisible
 * characters, runs of white space, and capital letters. With `trace`, it also records where in
 * the source each folded character came from, so a match can be turned back into the source's
 * own characters.
 */
function fold(source: string, trace: boolean): Folded {
  const out: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  let afterSpace = true; // true at the start, so leading white space is dropped
  const length = source.length;
  let i = 0;
  while (i < length) {
    const code = source.charCodeAt(i);
    let piece: string;
    let next: number;
    // Plain ASCII with nothing after it that could belong to it: one character in, one character out.
    const after = i + 1 === length ? 0x20 : source.charCodeAt(i + 1);
    if (code < 0x80 && after < 0x300 && after !== 0xad) {
      piece = ASCII[code];
      next = i + 1;
    } else {
      CLUSTER.lastIndex = i;
      const cluster = CLUSTER.exec(source)?.[0] ?? source[i];
      piece = foldCluster(cluster);
      next = i + cluster.length;
    }
    for (let k = 0; k < piece.length; k += 1) {
      const ch = piece[k];
      if (ch === " " || WHITE_SPACE.test(ch)) {
        if (afterSpace) continue;
        afterSpace = true;
        out.push(" ");
      } else {
        afterSpace = false;
        out.push(ch);
      }
      if (trace) {
        from.push(i);
        to.push(next);
      }
    }
    i = next;
  }
  if (out.length > 0 && out[out.length - 1] === " ") {
    out.pop();
    if (trace) {
      from.pop();
      to.pop();
    }
  }
  return { text: out.join(""), from, to };
}

/**
 * The text with typography folded away: straight quotes, plain hyphens, single spaces, no
 * invisible characters, lower case. Two pieces of text that read the same fold to the same string.
 */
export function normalizeText(text: string): string {
  return fold(text, false).text;
}

/** Tidies a piece of page text for showing on one line. The words and their spelling are untouched. */
function onOneLine(text: string): string {
  return text.replace(INVISIBLE, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
}

export type MatchLevel = "exact" | "loose";

export interface QuoteMatch {
  /** The page the quotation is actually on. */
  page: number;
  /** "exact": the same words. "loose": the same characters once spacing and hyphens are ignored. */
  level: MatchLevel;
  /** True when the quotation was found on a different page from the one named. */
  moved: boolean;
  /**
   * The wording as the page itself has it: the page's own characters, on one line. This, and
   * not the model's copy of it, is what should be kept and shown.
   */
  text: string;
}

interface PreparedPage {
  raw: string;
  folded: Folded;
  /** The folded text with spaces and hyphens taken out, for words split across lines ("adminis- tration"). */
  loose: string | null;
  /** For each character of `loose`, its position in the folded text. */
  looseAt: number[];
}

/** The pages of one request, prepared for looking quotations up. */
export class PageIndex {
  private readonly raw = new Map<number, string>();
  private readonly prepared = new Map<number, PreparedPage>();
  /** Page numbers in ascending order. */
  readonly pageNumbers: readonly number[];

  constructor(pages: readonly PageInput[]) {
    for (const p of pages) this.raw.set(p.page, p.text);
    this.pageNumbers = [...this.raw.keys()].sort((a, b) => a - b);
  }

  has(page: number): boolean {
    return this.raw.has(page);
  }

  private page(page: number): PreparedPage {
    let prepared = this.prepared.get(page);
    if (!prepared) {
      const raw = this.raw.get(page) ?? "";
      prepared = { raw, folded: fold(raw, true), loose: null, looseAt: [] };
      this.prepared.set(page, prepared);
    }
    return prepared;
  }

  private loose(prepared: PreparedPage): string {
    if (prepared.loose === null) {
      const kept: string[] = [];
      const { text } = prepared.folded;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === " " || ch === "-") continue;
        kept.push(ch);
        prepared.looseAt.push(i);
      }
      prepared.loose = kept.join("");
    }
    return prepared.loose;
  }

  /** The page's own characters for the folded characters from `start` up to, not including, `end`. */
  private wording(prepared: PreparedPage, start: number, end: number): string {
    return onOneLine(prepared.raw.slice(prepared.folded.from[start], prepared.folded.to[end - 1]));
  }

  private exactOn(page: number, wanted: string): string | null {
    const prepared = this.page(page);
    const at = prepared.folded.text.indexOf(wanted);
    return at === -1 ? null : this.wording(prepared, at, at + wanted.length);
  }

  private looseOn(page: number, wantedLoose: string): string | null {
    const prepared = this.page(page);
    const at = this.loose(prepared).indexOf(wantedLoose);
    if (at === -1) return null;
    return this.wording(prepared, prepared.looseAt[at], prepared.looseAt[at + wantedLoose.length - 1] + 1);
  }

  /**
   * Looks for a quotation, first on the page it names and then on the other pages, nearest first.
   * Returns null when the page is not one of the supplied pages or the words are nowhere to be found.
   * What comes back in `text` is copied from the page, never from the quotation.
   */
  find(quote: string, namedPage: number): QuoteMatch | null {
    if (!this.has(namedPage)) return null;
    const wanted = normalizeText(quote);
    if (!wanted) return null;
    const wantedLoose = wanted.replace(/[ -]+/g, "");
    if (!wantedLoose) return null;

    let text = this.exactOn(namedPage, wanted);
    if (text !== null) return { page: namedPage, level: "exact", moved: false, text };
    text = this.looseOn(namedPage, wantedLoose);
    if (text !== null) return { page: namedPage, level: "loose", moved: false, text };

    const others = this.pageNumbers
      .filter((p) => p !== namedPage)
      .sort((a, b) => Math.abs(a - namedPage) - Math.abs(b - namedPage) || a - b);
    for (const page of others) {
      text = this.exactOn(page, wanted);
      if (text !== null) return { page, level: "exact", moved: true, text };
    }
    for (const page of others) {
      text = this.looseOn(page, wantedLoose);
      if (text !== null) return { page, level: "loose", moved: true, text };
    }
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
