import Papa from "papaparse";
import type { ClaimRow } from "@/analyzer";

/**
 * Claims CSV handling for step 3 of the New Audit wizard: reading the file,
 * guessing which column is which, and turning rows into ClaimRow objects.
 * Everything here runs in the browser. The file is never uploaded.
 */

// ---- Fields -------------------------------------------------------------------------------------

export type ClaimField = "date" | "claimId" | "provider" | "category" | "billed" | "paid" | "member" | "feeType";

export interface ClaimFieldMeta {
  key: ClaimField;
  label: string;
  required: boolean;
  /** Column name used in the downloadable template. */
  header: string;
  help: string;
}

export const CLAIM_FIELDS: readonly ClaimFieldMeta[] = [
  { key: "date", label: "Date", required: true, header: "date", help: "Date of service, or the invoice date for a fee." },
  { key: "claimId", label: "Claim ID", required: true, header: "claim_id", help: "The reference that findings quote." },
  { key: "provider", label: "Provider", required: true, header: "provider", help: "Who billed it: a clinic, a pharmacy or the administrator." },
  { key: "category", label: "Category", required: true, header: "category", help: "For example Medical, Pharmacy, Fees or Rebate." },
  { key: "billed", label: "Billed amount", required: true, header: "billed", help: "The amount charged. On rebate rows, the rebate collected." },
  { key: "paid", label: "Paid amount", required: true, header: "paid", help: "The amount your plan paid. On rebate rows, the amount your plan received." },
  { key: "member", label: "Member ID", required: false, header: "member", help: "Used to tell people apart when matching. Never saved." },
  { key: "feeType", label: "Fee type", required: false, header: "fee_type", help: "The fee name on fee rows, such as Administrative Fee." },
];

const FIELD_LABEL = Object.fromEntries(CLAIM_FIELDS.map((f) => [f.key, f.label])) as Record<ClaimField, string>;

/** Column index for each field, or null when the field is not mapped. */
export type ColumnMapping = Record<ClaimField, number | null>;

export function emptyMapping(): ColumnMapping {
  return { date: null, claimId: null, provider: null, category: null, billed: null, paid: null, member: null, feeType: null };
}

/** Which number comes first in dates such as 03/04/2025. */
export type DateOrder = "mdy" | "dmy";
export type DateOrderSetting = "auto" | DateOrder;

export interface CsvTable {
  headers: string[];
  rows: string[][];
  /** Non-fatal notes about the file, for example a quotation mark that never closes. */
  warnings: string[];
}

// ---- Limits and errors --------------------------------------------------------------------------

export const MAX_CSV_BYTES = 50 * 1024 * 1024;
export const MAX_CLAIM_ROWS = 200_000;
export const PREVIEW_ROWS = 10;
const READ_CHUNK_BYTES = 1024 * 1024;
const MAX_LISTED_ISSUES = 50;
const MAX_WARNINGS = 5;
const GUESS_SAMPLE_ROWS = 200;

const SPREADSHEET_MESSAGE =
  "That is a spreadsheet file, not a CSV. In Excel choose File, Save As, CSV, then add the CSV here.";

/** A problem with the file that the user can act on. The message is safe to show as is. */
export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

/** Thrown by readCsvFile when isCancelled() returned true. */
export class CsvCancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CsvCancelledError";
  }
}

/** Internal: the bytes are not valid in the encoding that was tried. */
class DecodeError extends Error {}

/** Returns a friendly message if the file cannot be used, otherwise null. */
export function validateCsvFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xlsm|xlsb|xls|ods|numbers)$/.test(name)) return SPREADSHEET_MESSAGE;
  const isCsv = name.endsWith(".csv") || file.type === "text/csv" || file.type === "application/csv";
  if (!isCsv) return "Please choose a CSV file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_CSV_BYTES) return "That CSV is larger than 50 MB. Split it into smaller files and try again.";
  return null;
}

// ---- Reading ------------------------------------------------------------------------------------

export interface ReadCsvOptions {
  /** Receives a fraction from 0 to 1 as the file is read. */
  onProgress?: (fraction: number) => void;
  /** Checked between chunks. Return true to stop; the promise then rejects with CsvCancelledError. */
  isCancelled?: () => boolean;
}

const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Picks the text encoding from the first bytes, and rejects files that are clearly not text. */
function sniffEncoding(head: Uint8Array): { encoding: string; hasBom: boolean } {
  const startsWith = (...bytes: number[]): boolean => bytes.every((b, i) => head[i] === b);
  if (startsWith(0x50, 0x4b, 0x03, 0x04) || startsWith(0xd0, 0xcf, 0x11, 0xe0)) throw new CsvError(SPREADSHEET_MESSAGE);
  if (startsWith(0x25, 0x50, 0x44, 0x46)) throw new CsvError("That is a PDF. The claims file needs to be a CSV.");
  if (startsWith(0xff, 0xfe)) return { encoding: "utf-16le", hasBom: true };
  if (startsWith(0xfe, 0xff)) return { encoding: "utf-16be", hasBom: true };
  if (head.subarray(0, 2048).includes(0)) {
    throw new CsvError("That file does not look like a CSV. Export your claims as CSV and try again.");
  }
  return { encoding: "utf-8", hasBom: startsWith(0xef, 0xbb, 0xbf) };
}

interface ScanState {
  /** Where scanning resumes, as an index into the text still waiting to be parsed. */
  pos: number;
  inQuotes: boolean;
  fieldStart: boolean;
}

/**
 * Moves `state` forward over `text` and returns the index just past the last
 * row that ended in the part scanned, or -1 when no row ended there. Line
 * breaks inside quoted values do not end a row. Follows PapaParse's quoting
 * rule: a quotation mark only opens a quoted value at the very start of a field.
 */
function scanRowEnds(text: string, state: ScanState, delimiter: string, lineBreak: string): number {
  let end = -1;
  let i = state.pos;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (state.inQuotes) {
      if (ch !== '"') continue;
      if (i + 1 === text.length) break; // the next chunk shows whether this quote is escaped or closes the value
      if (text[i + 1] === '"') i += 1;
      else state.inQuotes = false;
    } else if (ch === '"' && state.fieldStart) {
      state.inQuotes = true;
      state.fieldStart = false;
    } else if (ch === lineBreak) {
      end = i + 1;
      state.fieldStart = true;
    } else {
      state.fieldStart = ch === delimiter;
    }
  }
  state.pos = i;
  return end;
}

/** Number of cells up to and including the last one that is not blank. */
function usedLength(row: string[]): number {
  let n = row.length;
  while (n > 0 && row[n - 1].trim() === "") n -= 1;
  return n;
}

function cleanHeaders(raw: string[], width: number): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const base = (raw[i] ?? "").replace(/^\uFEFF/, "").trim() || `Column ${i + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    out.push(count === 1 ? base : `${base} (${count})`);
  }
  return out;
}

async function readWithDecoder(file: File, strict: boolean, opts: ReadCsvOptions): Promise<CsvTable> {
  const onProgress = opts.onProgress ?? (() => {});
  const isCancelled = opts.isCancelled ?? (() => false);

  const all: string[][] = [];
  const warnings: string[] = [];
  const scan: ScanState = { pos: 0, inQuotes: false, fieldStart: true };
  let decoder: TextDecoder | null = null;
  let delimiter = "";
  let lineBreak = "\n";
  let pending = "";

  const consume = (text: string): void => {
    if (!text) return;
    const result = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: "greedy" });
    for (const e of result.errors) {
      if (e.type !== "Quotes" || warnings.length >= MAX_WARNINGS) continue;
      const near = all.length + (e.row ?? 0) + 1;
      warnings.push(`A quotation mark near row ${near} is not closed properly, so that row may have been read wrongly.`);
    }
    for (const row of result.data) {
      if (all.length > MAX_CLAIM_ROWS) {
        throw new CsvError(
          `That file has more than ${MAX_CLAIM_ROWS.toLocaleString("en-US")} rows. Split it into smaller files and try again.`,
        );
      }
      all.push(row);
    }
  };

  onProgress(0);
  for (let offset = 0; offset < file.size; offset += READ_CHUNK_BYTES) {
    if (isCancelled()) throw new CsvCancelledError();
    const bytes = new Uint8Array(await file.slice(offset, offset + READ_CHUNK_BYTES).arrayBuffer());
    const isLast = offset + READ_CHUNK_BYTES >= file.size;

    if (!decoder) {
      const sniffed = sniffEncoding(bytes);
      // Strict pass: any invalid byte stops the read, so a file in another encoding is noticed instead of garbled.
      // Second pass: a file with no byte-order mark that is not UTF-8 is almost always Windows-1252 (Excel on Windows).
      const encoding = strict || sniffed.hasBom ? sniffed.encoding : "windows-1252";
      decoder = new TextDecoder(encoding, { fatal: strict });
    }
    try {
      pending += decoder.decode(bytes, { stream: !isLast });
    } catch {
      throw new DecodeError();
    }

    if (!delimiter) {
      // Blank lines are skipped here too, or a trailing one makes a two-column file look like it has no delimiter.
      delimiter = Papa.parse<string[]>(pending, { preview: 1, skipEmptyLines: "greedy" }).meta.delimiter || ",";
      lineBreak = pending.includes("\n") ? "\n" : "\r";
    }
    // Hand only complete rows to the parser. An unfinished last row waits for the next chunk.
    let cut = pending.length;
    if (!isLast) {
      const end = scanRowEnds(pending, scan, delimiter, lineBreak);
      cut = end === -1 ? 0 : end;
    }
    consume(pending.slice(0, cut));
    pending = pending.slice(cut);
    scan.pos -= cut;

    onProgress(Math.min(1, (offset + bytes.length) / file.size));
    await yieldToUi();
  }
  if (isCancelled()) throw new CsvCancelledError();

  const first = all[0];
  if (!first) throw new CsvError("That file has no rows.");
  const rows = all.slice(1);
  if (rows.length === 0) throw new CsvError("That file has column names but no rows under them.");

  const named = usedLength(first);
  let width = named;
  let tooLong = 0;
  let firstTooLong = 0;
  rows.forEach((row, i) => {
    const used = usedLength(row);
    if (used <= named) return;
    if (used > width) width = used;
    tooLong += 1;
    if (firstTooLong === 0) firstTooLong = i + 2;
  });
  if (tooLong > 0) {
    warnings.push(
      `${tooLong.toLocaleString("en-US")} ${tooLong === 1 ? "row has" : "rows have"} more values than there are column names ` +
        `(first at row ${firstTooLong}). A comma inside a value that is not in quotation marks can cause this.`,
    );
  }
  return { headers: cleanHeaders(first, width), rows, warnings };
}

/**
 * Reads a CSV file in the browser with PapaParse. The file is read in 1 MB
 * pieces with a pause between them, so the page stays responsive and the
 * progress is real. The first row is taken as the column names.
 */
export async function readCsvFile(file: File, opts: ReadCsvOptions = {}): Promise<CsvTable> {
  try {
    return await readWithDecoder(file, true, opts);
  } catch (err) {
    if (!(err instanceof DecodeError)) throw err;
    return readWithDecoder(file, false, opts);
  }
}

// ---- Values -------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const NUMERIC_DATE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[T\s,].*)?$/;

function fullYear(text: string): number {
  const n = Number(text);
  if (text.length === 4) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

function iso(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null; // e.g. 30 February
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Reads a date in the common export formats and returns it as YYYY-MM-DD, or
 * null when it cannot be read. `order` only matters for all-number dates such
 * as 03/04/2025. A month with no day (2025-03, Mar 2025) becomes the 1st.
 */
export function parseDate(raw: string, order: DateOrder): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m: RegExpExecArray | null;

  // 2025-03-31, 2025/03/31, 2025-03-31T00:00:00
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s))) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  // 20250331
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  // 03/31/2025 or 31/03/2025, with an optional time after it
  if ((m = NUMERIC_DATE.exec(s))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return order === "dmy" ? iso(fullYear(m[3]), b, a) : iso(fullYear(m[3]), a, b);
  }
  // 31 Mar 2025, 31-Mar-25
  if ((m = /^(\d{1,2})[-\s.]([A-Za-z]{3,9})\.?,?[-\s.](\d{4}|\d{2})(?:\s.*)?$/.exec(s))) {
    const month = MONTHS[m[2].toLowerCase()];
    return month ? iso(fullYear(m[3]), month, Number(m[1])) : null;
  }
  // Mar 31, 2025
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?:\s.*)?$/.exec(s))) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? iso(Number(m[3]), month, Number(m[2])) : null;
  }
  // 2025-03, 03/2025, Mar 2025 (monthly fee rows)
  if ((m = /^(\d{4})[-/](\d{1,2})$/.exec(s))) return iso(Number(m[1]), Number(m[2]), 1);
  if ((m = /^(\d{1,2})[-/](\d{4})$/.exec(s))) return iso(Number(m[2]), Number(m[1]), 1);
  if ((m = /^([A-Za-z]{3,9})\.?[-\s]+(\d{4})$/.exec(s))) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? iso(Number(m[2]), month, 1) : null;
  }
  return null;
}

const isDateLike = (value: string): boolean => parseDate(value, "mdy") !== null || parseDate(value, "dmy") !== null;

/**
 * Works out whether all-number dates put the month or the day first, from any
 * value where one of the two numbers is above 12. `ambiguous` is true when the
 * column has such dates but none of them settles it; month first is assumed.
 */
export function detectDateOrder(values: Iterable<string>): { order: DateOrder; ambiguous: boolean } {
  let dayFirst = 0;
  let monthFirst = 0;
  let seen = 0;
  for (const value of values) {
    const m = NUMERIC_DATE.exec(value.trim());
    if (!m) continue;
    seen += 1;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dayFirst += 1;
    else if (b > 12 && a <= 12) monthFirst += 1;
  }
  if (dayFirst > monthFirst) return { order: "dmy", ambiguous: false };
  if (monthFirst > 0) return { order: "mdy", ambiguous: false };
  return { order: "mdy", ambiguous: seen > 0 };
}

/** "$1,234.50" -> 1234.5, "(45.00)" -> -45, "1.234,50" -> 1234.5. Returns null when the text is not a number. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true; // accounting style
    s = s.slice(1, -1);
  }
  s = s.replace(/USD|US\$|\$/gi, "").replace(/\s+/g, "");
  if (/^[-\u2212]/.test(s)) {
    negative = !negative;
    s = s.slice(1);
  } else if (/[-\u2212]$/.test(s)) {
    negative = !negative; // trailing minus, common in mainframe exports
    s = s.slice(0, -1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever comes last is the decimal mark.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma !== -1) {
    // "1,234" and "1,234,567" use thousands separators. "1234,5" and "0,75" use a decimal comma.
    s = /^\d{1,3}(?:,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n === 0 ? 0 : negative ? -n : n;
}

// ---- Column guessing ----------------------------------------------------------------------------

interface HeaderRules {
  /** The first pattern that matches wins, so the strongest come first. */
  rules: [pattern: RegExp, score: number][];
  /** A column name matching this is never used for the field. */
  never?: RegExp;
}

const HEADER_RULES: Record<ClaimField, HeaderRules> = {
  date: {
    rules: [
      [/^(date of service|service date|dos|date)$/, 100],
      [/^(claim|fill|incurred|invoice|transaction|billing|bill|statement|posting|post) date$/, 90],
      [/\b(date of service|service date|dos)\b/, 85],
      [/\b(from|begin|start) date\b|\bservice from\b/, 75],
      [/^(period|month|billing period|billing month|invoice month|service month)$/, 60],
      [/\b(paid|payment|processed|process|check|adjudicated|adjudication) date\b/, 40],
      [/\bdate\b|\bdt\b/, 30],
    ],
    never: /\b(birth|dob|through|thru|to|end|termination|eligibility|hire)\b/,
  },
  claimId: {
    rules: [
      [/^claim (id|identifier|number|no|num|nbr|ref|reference|control number)$/, 100],
      [/^claim$/, 90],
      [/\bclaim (id|identifier|number|no|num|nbr|ref)\b/, 80],
      [/^(icn|tcn|dcn|ccn)$|\bcontrol (number|no)\b/, 70],
      [/^(invoice|transaction|reference|record|charge|rx|prescription|document) (id|number|no|num|nbr|ref)$|^(reference|ref|id|invoice)$/, 60],
      [/^line (id|number|no)$/, 40],
    ],
    never: /\b(type|date|status|amount|amt|member|subscriber|patient|employee|provider|group|plan)\b/,
  },
  provider: {
    rules: [
      [/^(provider|provider name|billing provider|billing provider name)$/, 100],
      [/\b(provider|pharmacy|facility|vendor|payee|supplier|biller) name\b/, 90],
      [/^(rendering|servicing|service) provider$|^(pharmacy|facility|vendor|payee|supplier|biller|hospital|practice)$/, 80],
      [/\bprovider\b/, 50],
    ],
    never: /\b(type|specialty|state|zip|city|address|tax|tin|phone|network|status)\b/,
  },
  category: {
    rules: [
      [/^(category|claim category|service category|cost category|benefit category|expense category)$/, 100],
      [/^(claim type|service type|type of service|benefit type|benefit|line of business|lob|coverage type|coverage)$/, 85],
      [/\bcategory\b/, 70],
      [/^(type|class|classification)$/, 60],
    ],
    never: /\bfee\b/,
  },
  billed: {
    rules: [
      [/^(amount |amt )?billed( amount| amt| charges?)?$/, 100],
      [/\bbilled\b/, 90],
      [/^(total )?(charge|charges|charged|submitted|gross)( amount| amt| cost| charges?)?$/, 85],
      [/^(invoice|invoiced) (amount|amt|total)$|^invoiced$/, 85],
      [/^(amount|amt|total|total amount|cost|total cost)$/, 55],
      [/^allowed( amount| amt)?$/, 30],
    ],
    never: /\b(date|paid|by|to|code|type|id|number|no)\b/,
  },
  paid: {
    rules: [
      [/^(amount |amt |plan |net |total )?paid( amount| amt)?$/, 100],
      [/\bpaid\b/, 90],
      [/^(net |plan |total )?(payment|net|reimbursed|reimbursement|check|plan cost)( amount| amt)?$/, 80],
    ],
    never: /\b(date|by|to|status|code|type|method|member|patient|employee|id|number|no)\b/,
  },
  member: {
    rules: [
      [/^(member|subscriber|enrollee|employee|patient|participant|insured|cardholder|person) (id|identifier|number|no|num|nbr|ref)$/, 100],
      [/^(member|subscriber|enrollee|participant)$/, 90],
      [/^(employee|patient|insured|cardholder)$/, 75],
      [/^(member|subscriber|enrollee|employee|patient|participant) name$/, 60],
      [/\b(member|subscriber)\b/, 55],
    ],
    never: /\b(paid|amount|amt|cost|share|responsibility|copay|count|months|type|status|dob|birth|age|gender|sex|state|zip)\b/,
  },
  feeType: {
    rules: [
      [/^(fee type|fee name|fee description|fee category|type of fee|fee code)$/, 100],
      [/^fee$/, 90],
      [/^(charge type|line type|fee line)$/, 75],
      [/\bfee\b/, 50],
    ],
    never: /\b(amount|amt|total|paid|billed|rate|date)\b/,
  },
};

/** "ClaimID" -> "claim id", "Paid_Amt." -> "paid amt" */
function normaliseHeader(header: string): string {
  return header
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function headerScore(field: ClaimField, normalised: string): number {
  const { rules, never } = HEADER_RULES[field];
  if (never?.test(normalised)) return 0;
  return rules.find(([pattern]) => pattern.test(normalised))?.[1] ?? 0;
}

/** Whether a column's values could plausibly be this field. Only dates, amounts and fee names can be judged. */
function valuesFit(field: ClaimField, values: string[]): boolean {
  if (values.length === 0) return true;
  const share = (test: (value: string) => boolean): number => values.filter(test).length / values.length;
  if (field === "date") return share(isDateLike) >= 0.5;
  if (field === "billed" || field === "paid") return share((v) => parseAmount(v) !== null) >= 0.5;
  // A fee type is a name. A column of numbers is far more likely to be the fee amount.
  if (field === "feeType") return share((v) => parseAmount(v) !== null) < 0.5;
  return true;
}

/**
 * Guesses which column holds which field from the column names, checking date
 * and amount columns against their values. Each column is used at most once.
 * `guessed` lists the fields that were filled in.
 */
export function guessMapping(table: CsvTable): { mapping: ColumnMapping; guessed: ClaimField[] } {
  const sample = table.rows.slice(0, GUESS_SAMPLE_ROWS);
  const valuesOf = (col: number): string[] => sample.map((r) => (r[col] ?? "").trim()).filter(Boolean);
  const normalised = table.headers.map(normaliseHeader);

  const candidates: { field: ClaimField; col: number; score: number; order: number }[] = [];
  CLAIM_FIELDS.forEach(({ key }, order) => {
    normalised.forEach((name, col) => {
      const score = headerScore(key, name);
      if (score > 0 && valuesFit(key, valuesOf(col))) candidates.push({ field: key, col, score, order });
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.order - b.order || a.col - b.col);

  const mapping = emptyMapping();
  const usedCols = new Set<number>();
  for (const c of candidates) {
    if (mapping[c.field] !== null || usedCols.has(c.col)) continue;
    mapping[c.field] = c.col;
    usedCols.add(c.col);
  }

  // No column was named like a date: accept a single leftover column whose values all read as dates.
  if (mapping.date === null) {
    const dateLike = table.headers
      .map((_, col) => col)
      .filter((col) => {
        if (usedCols.has(col)) return false;
        const values = valuesOf(col);
        return values.length > 0 && values.every(isDateLike);
      });
    if (dateLike.length === 1) mapping.date = dateLike[0];
  }

  return { mapping, guessed: CLAIM_FIELDS.map((f) => f.key).filter((key) => mapping[key] !== null) };
}

/** True when the "column names" look like values, which suggests the file has no header row. */
export function headersLookLikeData(headers: string[]): boolean {
  return headers.some((h) => isDateLike(h) || parseAmount(h) !== null);
}

/** First non-empty value in a column, for showing an example next to a mapping. */
export function exampleValue(table: CsvTable, col: number | null): string | null {
  if (col === null) return null;
  for (const row of table.rows.slice(0, GUESS_SAMPLE_ROWS)) {
    const value = (row[col] ?? "").trim();
    if (value) return value;
  }
  return null;
}

// ---- Rows to claims -----------------------------------------------------------------------------

export interface RowIssue {
  /** Row number as a spreadsheet shows it: the column names are row 1. */
  row: number;
  field: ClaimField;
  message: string;
}

export interface ClaimsResult {
  /** Rows that passed every check, ready for the analyzer. */
  claims: ClaimRow[];
  totalRows: number;
  /** Rows left out: a required value was missing or could not be read, or the row is one of the template's examples. */
  skippedRows: number;
  /** How many of the skipped rows are example rows left over from the template. */
  exampleRows: number;
  /** The first problems found, in file order (capped). */
  issues: RowIssue[];
  issueCount: number;
  issuesByField: Partial<Record<ClaimField, number>>;
  /** Problems with the column choices themselves. Any entry here blocks the step. */
  mappingErrors: Partial<Record<ClaimField, string>>;
  /** The order used for all-number dates. */
  dateOrder: DateOrder;
  /** True when that order was assumed because the dates did not settle it. */
  dateOrderAmbiguous: boolean;
  /** True when the column choices are complete and at least one row is usable. */
  ok: boolean;
}

const EXAMPLE_ID = /^EXAMPLE-/i;

function checkMapping(headers: string[], mapping: ColumnMapping): Partial<Record<ClaimField, string>> {
  const errors: Partial<Record<ClaimField, string>> = {};
  const firstUse = new Map<number, ClaimField>();
  for (const { key, label, required } of CLAIM_FIELDS) {
    const col = mapping[key];
    if (col === null) {
      // Only the first letter is lowered, so "Claim ID" reads "claim ID".
      if (required) errors[key] = `Choose the column that holds the ${label.charAt(0).toLowerCase()}${label.slice(1)}.`;
      continue;
    }
    const other = firstUse.get(col);
    if (other === undefined) {
      firstUse.set(col, key);
      continue;
    }
    // One amount column may serve as both billed and paid. Any other reuse is a mistake.
    const amountPair = (key === "billed" || key === "paid") && (other === "billed" || other === "paid");
    if (!amountPair) {
      errors[key] = `"${headers[col] ?? `Column ${col + 1}`}" is already used for ${FIELD_LABEL[other]}. Choose a different column.`;
    }
  }
  return errors;
}

function* columnValues(rows: string[][], col: number): Generator<string> {
  for (const row of rows) yield row[col] ?? "";
}

/**
 * Turns CSV rows into ClaimRow objects using the chosen columns. Dates are
 * normalised to YYYY-MM-DD and amounts to numbers. A row with a missing or
 * unreadable required value is left out and reported, never guessed at.
 */
export function mapClaims(table: CsvTable, mapping: ColumnMapping, dateSetting: DateOrderSetting): ClaimsResult {
  const mappingErrors = checkMapping(table.headers, mapping);
  const detected =
    mapping.date === null
      ? { order: "mdy" as const, ambiguous: false }
      : detectDateOrder(columnValues(table.rows, mapping.date));
  const dateOrder = dateSetting === "auto" ? detected.order : dateSetting;
  const result: ClaimsResult = {
    claims: [],
    totalRows: table.rows.length,
    skippedRows: 0,
    exampleRows: 0,
    issues: [],
    issueCount: 0,
    issuesByField: {},
    mappingErrors,
    dateOrder,
    dateOrderAmbiguous: dateSetting === "auto" && detected.ambiguous,
    ok: false,
  };
  if (Object.keys(mappingErrors).length > 0) return result;

  table.rows.forEach((cells, index) => {
    const read = (field: ClaimField): string => {
      const col = mapping[field];
      return col === null ? "" : (cells[col] ?? "").trim();
    };
    const problems: [ClaimField, string][] = [];

    const claimId = read("claimId");
    const rawDate = read("date");
    const provider = read("provider");
    const category = read("category");
    const rawBilled = read("billed");
    const rawPaid = read("paid");
    const date = parseDate(rawDate, dateOrder);
    const billed = parseAmount(rawBilled);
    const paid = parseAmount(rawPaid);

    if (EXAMPLE_ID.test(claimId)) {
      result.exampleRows += 1;
      problems.push(["claimId", "This is an example row from the template."]);
    } else {
      if (!rawDate) problems.push(["date", "The date is empty."]);
      else if (date === null) problems.push(["date", `The date "${rawDate}" could not be read.`]);
      if (!claimId) problems.push(["claimId", "The claim ID is empty."]);
      if (!provider) problems.push(["provider", "The provider is empty."]);
      if (!category) problems.push(["category", "The category is empty."]);
      if (!rawBilled) problems.push(["billed", "The billed amount is empty."]);
      else if (billed === null) problems.push(["billed", `The billed amount "${rawBilled}" is not a number.`]);
      if (!rawPaid) problems.push(["paid", "The paid amount is empty."]);
      else if (paid === null) problems.push(["paid", `The paid amount "${rawPaid}" is not a number.`]);
    }

    if (problems.length > 0 || date === null || billed === null || paid === null) {
      result.skippedRows += 1;
      for (const [field, message] of problems) {
        result.issueCount += 1;
        result.issuesByField[field] = (result.issuesByField[field] ?? 0) + 1;
        if (result.issues.length < MAX_LISTED_ISSUES) result.issues.push({ row: index + 2, field, message });
      }
      return;
    }

    const claim: ClaimRow = { claimId, date, provider, category, billed, paid };
    const feeType = read("feeType");
    const member = read("member");
    if (feeType) claim.feeType = feeType;
    if (member) claim.member = member;
    result.claims.push(claim);
  });

  result.ok = result.claims.length > 0;
  return result;
}

// ---- Template and sample ------------------------------------------------------------------------

export const TEMPLATE_FILE_NAME = "contractsoup-claims-template.csv";

/** A small CSV with the expected column names and three example rows. Example rows are skipped if left in. */
export function buildTemplateCsv(): string {
  const rows = [
    ["2025-01-14", "EXAMPLE-001", "Lakeshore Family Medicine", "Medical", "420.00", "336.00", "M-1001", ""],
    ["2025-01-01", "EXAMPLE-002", "Northwind Health Partners", "Fees", "24.50", "24.50", "M-1001", "Administrative Fee"],
    ["2025-03-31", "EXAMPLE-003", "Northwind Health Partners", "Rebate", "21400.00", "19260.00", "", ""],
  ];
  return `${Papa.unparse({ fields: CLAIM_FIELDS.map((f) => f.header), data: rows })}\r\n`;
}

/** Lays claim rows out as a CSV table with the template's columns. Used to load the built-in sample. */
export function claimsToTable(claims: ClaimRow[]): CsvTable {
  const cell: Record<ClaimField, (c: ClaimRow) => string> = {
    date: (c) => c.date,
    claimId: (c) => c.claimId,
    provider: (c) => c.provider,
    category: (c) => c.category,
    billed: (c) => c.billed.toFixed(2),
    paid: (c) => c.paid.toFixed(2),
    member: (c) => c.member ?? "",
    feeType: (c) => c.feeType ?? "",
  };
  return {
    headers: CLAIM_FIELDS.map((f) => f.header),
    rows: claims.map((c) => CLAIM_FIELDS.map((f) => cell[f.key](c))),
    warnings: [],
  };
}
