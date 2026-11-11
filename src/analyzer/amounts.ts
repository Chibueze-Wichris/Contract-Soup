export type AmountType = "dollar" | "percent" | "days";

export interface Amount {
  type: AmountType;
  value: number;
  /** Offsets into the text that was searched. */
  start: number;
  end: number;
}

const DOLLAR = /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(million|thousand)\b)?/gi;
const PERCENT = /(\d+(?:\.\d+)?)\s?(?:%|percent\b)/gi;
const DAYS = /\(?(\d+)\)?\s*(?:calendar\s+|business\s+)?days?\b/gi;

/** Every dollar, percent and day amount in the text, in reading order. */
export function findAmounts(text: string): Amount[] {
  const out: Amount[] = [];
  for (const m of text.matchAll(DOLLAR)) {
    const base = Number((m[1] ?? "0").replace(/,/g, "") + (m[2] ?? ""));
    const mult = m[3] ? (m[3].toLowerCase() === "million" ? 1_000_000 : 1_000) : 1;
    const start = m.index ?? 0;
    out.push({ type: "dollar", value: base * mult, start, end: start + m[0].length });
  }
  for (const m of text.matchAll(PERCENT)) {
    const start = m.index ?? 0;
    out.push({ type: "percent", value: Number(m[1]), start, end: start + m[0].length });
  }
  for (const m of text.matchAll(DAYS)) {
    const start = m.index ?? 0;
    out.push({ type: "days", value: Number(m[1]), start, end: start + m[0].length });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Describe what a dollar amount is "per", from the words right after it. */
export function inferUnit(text: string, a: Amount): string {
  if (a.type === "percent") return "%";
  if (a.type === "days") return "days";
  const tail = text.slice(a.end, a.end + 70);
  if (/^\s*(?:\(?\s*PEPM\s*\)?|per\s+(?:enrolled\s+)?(?:employee|member|subscriber)\s+per\s+month)/i.test(tail)) return "USD PEPM";
  if (/^\s*per\s+(?:[a-z-]+\s+){0,3}?(?:claim|prescription|script|fill)\b/i.test(tail)) return "USD/claim";
  if (/^\s*per\s+(?:covered\s+)?(?:individual|person|member|employee)\b/i.test(tail)) return "USD/person";
  if (/^\s*(?:per\s+month|monthly)\b/i.test(tail)) return "USD/month";
  if (/^\s*(?:per\s+(?:contract\s+|plan\s+|calendar\s+)?year|annually|per\s+annum)\b/i.test(tail)) return "USD/year";
  return "USD";
}

function distance(a: Amount, from: number, to: number): number {
  if (a.start >= to) return a.start - to;
  if (a.end <= from) return from - a.end;
  return 0;
}

/**
 * Pick the amount closest to the keyword. Prefers the wanted type; falls back
 * to any type unless `strict`, where only the wanted type is acceptable.
 */
export function pickAmount(
  list: Amount[],
  prefer: AmountType | "any",
  from: number,
  to: number,
  strict: boolean,
): Amount | undefined {
  const closest = (items: Amount[]): Amount | undefined =>
    [...items].sort((x, y) => distance(x, from, to) - distance(y, from, to) || x.start - y.start)[0];
  if (prefer !== "any") {
    const wanted = closest(list.filter((a) => a.type === prefer));
    if (wanted || strict) return wanted;
  }
  return closest(list);
}
