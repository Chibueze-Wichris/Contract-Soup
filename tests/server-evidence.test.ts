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
  assert.deepEqual(index.find('fee of $24.50 per employee per month ("PEPM"), invoiced monthly', 4), { page: 4, level: "exact", moved: false });
});

test("a word split across a line still matches, and is reported as a loose match", () => {
  const index = new PageIndex(PAGES);
  assert.deepEqual(index.find("Client shall pay Administrator an administrative fee of $24.50", 4), { page: 4, level: "loose", moved: false });
});

test("a quotation on another page is found there, nearest page first", () => {
  const index = new PageIndex([...PAGES, { page: 9, text: PAGES[2].text }]);
  assert.deepEqual(index.find("Client shall pay a dispensing fee of $1.50 per retail brand claim.", 4), { page: 5, level: "exact", moved: true });
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
