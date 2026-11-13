import assert from "node:assert/strict";
import { test } from "node:test";
import { PageIndex, findFigure, isIsoDate, normalizeText, quoteShowsUnit, quoteShowsYear } from "../supabase/functions/_shared/evidence.ts";

const PAGES = [
  { page: 3, text: "2.2 Renewal. After the initial term, this Agreement shall automatically renew for successive one-year terms." },
  {
    page: 4,
    text: "3.1 Administrative Fee. Client shall pay Administrator an adminis-\ntrative fee of $24.50 per employee per month (\u201CPEPM\u201D),\n   invoiced   monthly.",
  },
  { page: 5, text: "4.4 Dispensing Fee. Client shall pay a dispensing fee of $1.50 per retail brand claim." },
];

test("normalizeText folds typography, spacing and capitals, and nothing else", () => {
  assert.equal(normalizeText("  The \u201CEffective\u00A0Date\u201D \u2014 Client\u2019s  "), 'the "effective date" - client\'s');
  assert.equal(normalizeText("of\uFB01ce\u00ADs"), "offices");
  assert.notEqual(normalizeText("$24.50"), normalizeText("$24.05"));
});

test("a quotation is found on the page it names, whatever the quote marks and line breaks", () => {
  const index = new PageIndex(PAGES);
  assert.deepEqual(index.find('fee of $24.50 per employee per month ("PEPM"), invoiced monthly', 4), {
    page: 4,
    level: "exact",
    moved: false,
    // The page's own characters, curly quotes and all, on one line.
    text: "fee of $24.50 per employee per month (\u201CPEPM\u201D), invoiced monthly",
  });
});

test("a word split across a line still matches, and is reported as a loose match", () => {
  const index = new PageIndex(PAGES);
  assert.deepEqual(index.find("Client shall pay Administrator an administrative fee of $24.50", 4), {
    page: 4,
    level: "loose",
    moved: false,
    text: "Client shall pay Administrator an adminis- trative fee of $24.50",
  });
});

test("a quotation on another page is found there, nearest page first", () => {
  const index = new PageIndex([...PAGES, { page: 9, text: PAGES[2].text }]);
  assert.deepEqual(index.find("Client shall pay a dispensing fee of $1.50 per retail brand claim.", 4), {
    page: 5,
    level: "exact",
    moved: true,
    text: "Client shall pay a dispensing fee of $1.50 per retail brand claim.",
  });
});

test("what is kept is the page's wording, not the copy that was sent in", () => {
  const page = "7.1 Fees. The Client shall pay the SERVICES FEE of \u201C$1,250.00\u201D per month \u2014 see Schedule\u00A0A \uFB01rst.";
  const index = new PageIndex([{ page: 1, text: page }]);
  // The copy differs in capitals, quote marks, the dash and the ligature. None of that survives.
  const copy = 'the client shall pay the services fee of "$1,250.00" per month - see schedule a first.';
  const match = index.find(copy, 1);
  assert.ok(match);
  assert.equal(match.level, "exact");
  // Every letter, figure and mark is the page's. Only white space is tidied: the no-break space becomes a plain one.
  assert.equal(match.text, "The Client shall pay the SERVICES FEE of \u201C$1,250.00\u201D per month \u2014 see Schedule A \uFB01rst.");
  assert.ok(page.replace(/\s/g, " ").includes(match.text), "the wording kept is a piece of the page, character for character");
  assert.equal(findFigure(1250, match.text), "$1,250.00");

  // Looking the kept wording up again finds the same thing: the check can be repeated anywhere.
  assert.deepEqual(index.find(match.text, 1), match);
});

test("for any piece of any page, looking it up gives back that piece of the page", () => {
  // Text with the things PDF extraction produces: ligatures, soft hyphens, odd spaces, accents in both forms, astral characters.
  const alphabet = [
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    ..." \n\t.,;:()$%-'\"",
    "\u00A0", "\u2009", "\u00AD", "\u200B", "\u2014", "\u2013", "\u2019", "\u201C", "\u201D", "\uFB01", "\uFB02", "\u00E9", "e\u0301", "\u0301",
    "\u00BD", "\u2026", "\u2122", "\u0130", "\u03A3", "\uD83D\uDCC4", "\uFF21", "\u00DF", "\u0001",
  ];
  let seed = 20261111;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const pick = (): string => alphabet[Math.floor(random() * alphabet.length)];

  for (let round = 0; round < 300; round += 1) {
    const page = Array.from({ length: 40 + Math.floor(random() * 200) }, pick).join("");
    const index = new PageIndex([{ page: 1, text: page }]);
    const folded = normalizeText(page);
    assert.equal(normalizeText(folded), folded, `round ${round}: folding twice is not the same as folding once`);
    if (folded.length < 12) continue;
    const start = Math.floor(random() * (folded.length - 10));
    const wanted = folded.slice(start, start + 4 + Math.floor(random() * 30)).trim();
    if (!wanted.replace(/[ -]/g, "")) continue;

    const match = index.find(wanted, 1);
    assert.ok(match, `round ${round}: a piece of the page was not found on the page`);
    // What comes back reads the same as what was asked for, and is made of the page's own characters.
    assert.ok(normalizeText(match.text).includes(wanted), `round ${round}: "${match.text}" does not contain "${wanted}"`);
    const strip = (t: string): string => t.replace(/[\s\u00AD\u200B-\u200D\u2060\uFEFF\u0000-\u001F\u007F]+/g, "");
    assert.ok(strip(page).includes(strip(match.text)), `round ${round}: "${match.text}" is not a piece of the page`);
    assert.deepEqual(index.find(match.text, 1)?.text, match.text, `round ${round}: looking it up again gave something else`);
  }
});

test("folding is the same whether a text is folded whole or in pieces", () => {
  const samples = [
    "The \u201CEffective\u00A0Date\u201D \u2014 Client\u2019s",
    "re\u0301sume\u0301 and r\u00E9sum\u00E9",
    "O\uFB03ce \uFB01le \uFF21\uFF22\uFF23 \u00BD \u2026",
    "A\u0300\u0301 mixed  \t spacing\n\nand\u00ADsoft hyphens",
  ];
  for (const text of samples) {
    const words = text.split(" ");
    assert.equal(normalizeText(words.map((w) => normalizeText(w)).join(" ")), normalizeText(text));
  }
  assert.equal(normalizeText("re\u0301sume\u0301"), normalizeText("r\u00E9sum\u00E9"), "an accent typed after the letter is the same letter");
});

test("wording that is not in the pages is not found", () => {
  const index = new PageIndex(PAGES);
  assert.equal(index.find("Client shall pay an implementation fee of $50,000.", 4), null);
  assert.equal(index.find("fee of $24.05 per employee per month", 4), null, "one changed digit is a different quotation");
  assert.equal(index.find("fee of $24.50 ... invoiced monthly", 4), null, "an ellipsis is not a quotation");
  assert.equal(index.find("   ", 4), null);
});

test("a page that was not supplied is never matched, even when the words exist elsewhere", () => {
  const index = new PageIndex(PAGES);
  assert.equal(index.has(40), false);
  assert.equal(index.find("Client shall pay a dispensing fee of $1.50 per retail brand claim.", 40), null);
});

test("findFigure finds a figure written in digits", () => {
  assert.equal(findFigure(24.5, "an administrative fee of $24.50 per employee per month"), "$24.50");
  assert.equal(findFigure(3600, "a network access fee of $3,600 per Contract Year"), "$3,600");
  assert.equal(findFigure(90, "ninety percent (90%) of all Manufacturer Rebates"), "90");
  assert.equal(findFigure(1250000, "a cap of $1.25 million per year"), "$1.25 million");
  assert.equal(findFigure(150000, "attachment point of $150,000 per Covered Individual"), "$150,000");
});

test("findFigure finds a figure written in words", () => {
  assert.equal(findFigure(90, "at least ninety days before the end of the term"), "ninety");
  assert.equal(findFigure(85, "not less than eighty-five percent of expected claims"), "eighty-five");
  assert.equal(findFigure(120, "within one hundred twenty days after the Contract Year ends"), "one hundred twenty");
  assert.equal(findFigure(180, "one hundred and eighty days"), "one hundred and eighty");
});

test("findFigure says no when the figure is not there", () => {
  assert.equal(findFigure(25, "reports within twenty (20) days after the end of each month"), null);
  assert.equal(findFigure(24.05, "an administrative fee of $24.50"), null);
  assert.equal(findFigure(2, "a fee of $24.50"), null, "part of a number is not the number");
  assert.equal(findFigure(Number.NaN, "a fee of $24.50"), null);
});

test("quoteShowsUnit looks for the sign of the unit", () => {
  assert.equal(quoteShowsUnit("USD PEPM", "a fee of $24.50 per employee per month"), true);
  assert.equal(quoteShowsUnit("USD PEPM", "a fee of 24.50 per employee per month"), false);
  assert.equal(quoteShowsUnit("%", "ninety percent of rebates"), true);
  assert.equal(quoteShowsUnit("%", "ninety days"), false);
  assert.equal(quoteShowsUnit("days", "upon sixty (60) days' notice"), true);
  assert.equal(quoteShowsUnit("", "anything"), true);
});

test("dates must be real, and the year must be in the wording", () => {
  assert.equal(isIsoDate("2025-01-01"), true);
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("2025-02-29"), false);
  assert.equal(isIsoDate("2025-13-01"), false);
  assert.equal(isIsoDate("January 1, 2025"), false);
  assert.equal(quoteShowsYear("2025-01-01", "entered into as of January 1, 2025"), true);
  assert.equal(quoteShowsYear("2025-01-01", "entered into as of the Effective Date"), false);
  assert.equal(quoteShowsYear("2025-01-01", "invoice 120256"), false);
});
