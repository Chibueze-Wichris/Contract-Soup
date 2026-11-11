import { categoryLabel } from "./categories";
import { findAmounts, inferUnit, pickAmount, type Amount } from "./amounts";
import { EXTRACTION_RULES } from "./rules";
import type { Confidence, ContractTerm, PageText } from "./types";

interface Sentence {
  start: number;
  end: number;
  text: string;
}

interface Candidate {
  term: Omit<ContractTerm, "id">;
  /** Absolute offset of the chosen amount, used to drop duplicate matches of the same amount. */
  amountStart?: number;
}

const WINDOW = 200;
const SNIPPET_TARGET = 200;
const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let last = 0;
  for (const m of text.matchAll(/(?<=[.!?])\s+(?=[A-Z0-9(“"‘'])/g)) {
    const idx = m.index ?? 0;
    out.push({ start: last, end: idx, text: text.slice(last, idx) });
    last = idx + m[0].length;
  }
  out.push({ start: last, end: text.length, text: text.slice(last) });
  return out;
}

/** About 200 characters of context that always contains the span [from, to). */
function makeSnippet(text: string, from: number, to: number): string {
  const extra = Math.max(0, SNIPPET_TARGET - (to - from));
  let start = Math.max(0, from - Math.floor(extra / 2));
  let end = Math.min(text.length, to + (extra - (from - start)));
  if (end === text.length) start = Math.max(0, start - (to + (extra - (from - start)) - end));
  if (start > 0) {
    const s = text.indexOf(" ", start);
    if (s !== -1 && s < from) start = s + 1;
  }
  if (end < text.length) {
    const e = text.lastIndexOf(" ", end);
    if (e > to) end = e;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function pageCandidates(page: PageText): Candidate[] {
  const text = page.text.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const allAmounts = findAmounts(text);
  const candidates: Candidate[] = [];

  for (const sentence of splitSentences(text)) {
    for (const rule of EXTRACTION_RULES) {
      const m = rule.pattern.exec(sentence.text);
      if (!m) continue;
      const from = sentence.start + m.index;
      const to = from + m[0].length;
      const strict = rule.strict === true;
      const amounts = rule.exclude ? allAmounts.filter((a) => !rule.exclude?.includes(a.type)) : allAmounts;

      const inSentence = amounts.filter((a) => a.start >= sentence.start && a.end <= sentence.end);
      let chosen: Amount | undefined = pickAmount(inSentence, rule.prefer, from, to, strict);
      let confidence: Confidence = "low";

      if (chosen) {
        confidence = "high";
      } else if (!rule.clause) {
        const nearby = amounts.filter((a) => a.end >= from - WINDOW && a.start <= to + WINDOW);
        chosen = pickAmount(nearby, rule.prefer, from, to, strict);
        if (chosen) confidence = "medium";
        else if (strict && (inSentence.length > 0 || nearby.length > 0)) continue; // amounts belong to something else
      }
      if (rule.clause) confidence = chosen ? "high" : "medium";

      const spanFrom = Math.min(from, chosen?.start ?? from);
      const spanTo = Math.max(to, chosen?.end ?? to);
      candidates.push({
        amountStart: chosen?.start,
        term: {
          category: rule.category,
          label: categoryLabel(rule.category),
          value: chosen ? chosen.value : rule.clause ? "Clause present" : null,
          unit: chosen ? inferUnit(text, chosen) : "",
          pageRef: page.page,
          snippet: makeSnippet(text, spanFrom, spanTo),
          confidence,
          confirmed: false,
          match: m[0].trim(),
        },
      });
    }
  }

  // A heading such as "4.1 Administrative Fee." finds the amount in the next
  // sentence. Keep only the best candidate for each amount in each category.
  return candidates.filter((c, i) => {
    if (c.amountStart === undefined) return true;
    return !candidates.some((o, j) => {
      if (j === i || o.amountStart !== c.amountStart || o.term.category !== c.term.category) return false;
      const better = CONFIDENCE_RANK[o.term.confidence] - CONFIDENCE_RANK[c.term.confidence];
      return better > 0 || (better === 0 && j < i);
    });
  });
}

/** Keyword and regex extraction. Deterministic: the same pages always give the same terms. */
export function extractTermsFromPages(pages: PageText[]): ContractTerm[] {
  const counters = new Map<string, number>();
  const terms: ContractTerm[] = [];
  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    for (const { term } of pageCandidates(page)) {
      const key = `${term.category}-p${page.page}`;
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      terms.push({ id: `${key}-${n}`, ...term });
    }
  }
  return terms;
}
