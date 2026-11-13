/**
 * The Gemini reader, used the way a person uses it: the built app in a real browser, against a
 * stand-in Supabase project that runs the real Edge Function handler. Only Google is a stand-in.
 *
 * This is where the promises that live in the screens and in the draft are tested:
 *   - nothing is sent before the box is ticked, and only page text is sent after;
 *   - a failure stops the audit, and the built-in reader never steps in unasked;
 *   - every term Gemini finds waits for a person;
 *   - checking the claims sends nothing, and gives the same money result as before.
 * The app and the project are served from different addresses and the browser's web security is
 * on, so the cross-origin headers of the function's answers are tested as well.
 *
 * It needs a Chrome and puppeteer-core. Without them the tests are skipped, and say so. To run them:
 *   npm i --no-save puppeteer-core
 *   CHROME_BIN=/path/to/chrome npm test        (CHROME_BIN is only needed when Chrome is not in a usual place)
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { DEFAULT_LIMITS } from "../supabase/functions/_shared/limits.ts";
import { chooseFile, clickButton, launchBrowser, pageText, pause, shot, termRows, waitForText, whyNoBrowser, writePdf, writeSampleFiles, type Browser, type Page } from "./helpers/browser";
import { feeSchedule } from "./helpers/client";
import { STAND_IN_PUBLISHABLE_KEY, STAND_IN_USER, serveFolder, startStandIn, type StandIn, type StandInMode } from "./helpers/standIn";
import { TEST_KEY } from "./helpers/stubs";

const ROOT = path.resolve(import.meta.dirname, "..");
const skip = whyNoBrowser() ?? false;
const options = { skip, timeout: 180_000 };

const CONSENT_BOX = 'fieldset input[type="checkbox"]';
const GEMINI_CHOICE = 'input[name="contract-reader"][value="gemini"]';
const BUILT_IN_CHOICE = 'input[name="contract-reader"][value="local"]';
/** Anything from the claims file: claim ids, member ids, a provider, or the field names of a claim. */
const CLAIMS_DATA = /C-\d{5}|M-\d{4}|Pine Street Pharmacy|"claimId"|"member"|"billed"/;

let project: StandIn;
let app: { origin: string; close(): Promise<void> };
/** The same app built without VITE_ANALYZER_MODE=gemini. */
let plainApp: { origin: string; close(): Promise<void> };
let browser: Browser;
let page: Page;
let folder = "";
let files: { pdf: string; csv: string };
const problems: string[] = [];

before(
  async () => {
    if (skip) return;
    project = await startStandIn();
    folder = mkdtempSync(path.join(os.tmpdir(), "contractsoup-browser-"));
    files = writeSampleFiles(folder);

    // The project's address is fixed into the app when it is built, as on a real deployment. So is the
    // switch that offers the Gemini reader. A value set here wins over one in a .env file.
    const build = (outDir: string, mode: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"], {
          cwd: ROOT,
          env: { ...process.env, VITE_SUPABASE_URL: project.origin, VITE_SUPABASE_PUBLISHABLE_KEY: STAND_IN_PUBLISHABLE_KEY, VITE_ANALYZER_MODE: mode },
          stdio: ["ignore", "ignore", "pipe"],
        });
        let complaints = "";
        child.stderr.on("data", (chunk: Buffer) => (complaints += chunk.toString("utf8")));
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`the app did not build: ${complaints}`))));
      });
    const dist = path.join(folder, "dist");
    const plainDist = path.join(folder, "dist-plain");
    await Promise.all([build(dist, "gemini"), build(plainDist, "local")]);
    app = await serveFolder(dist);
    plainApp = await serveFolder(plainDist);
    assert.notEqual(app.origin, project.origin, "the app and the project are different origins");

    browser = await launchBrowser();
    page = await browser.newPage();
    // With a draft in progress the app asks before the page is left. The tests answer "leave".
    page.on("dialog", (dialog) => void dialog.accept());
    page.on("pageerror", (error) => problems.push(`error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      // The browser logs every request that fails, and the tests make requests fail on purpose.
      if (/Failed to load resource|blocked by CORS policy/.test(message.text())) return;
      problems.push(`console: ${message.text()}`);
    });
    await signIn(app.origin);
  },
  { timeout: 300_000 },
);

/** Signs in to the app served at this address. Each address keeps its own session. */
async function signIn(origin: string): Promise<void> {
  await page.goto(`${origin}/`, { waitUntil: "networkidle0" });
  await page.type('input[type="email"]', STAND_IN_USER.email);
  await page.type('input[type="password"]', STAND_IN_USER.password);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !document.body.innerText.includes("Work email"), { timeout: 20_000 });
}

after(async () => {
  await browser?.close();
  await app?.close();
  await plainApp?.close();
  await project?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

/** A new audit with nothing in it. Reloading empties the draft, which is kept in memory only. */
async function freshAudit(mode: StandInMode): Promise<void> {
  project.mode = mode;
  await page.goto(`${app.origin}/#/audit/new`, { waitUntil: "networkidle0" });
  await page.reload({ waitUntil: "networkidle0" });
  assert.ok(await waitForText(page, "Who reads the contract"), "the reader choice is offered");
  project.forget();
}

async function chooseGemini(agree: boolean): Promise<void> {
  await page.click(GEMINI_CHOICE);
  await page.waitForSelector(CONSENT_BOX);
  if (agree) await page.click(CONSENT_BOX);
}

const isTicked = (selector: string): Promise<boolean> => page.evaluate((s: string) => (document.querySelector(s) as HTMLInputElement | null)?.checked === true, selector);
const exists = (selector: string): Promise<boolean> => page.evaluate((s: string) => document.querySelector(s) !== null, selector);
const sentAnything = (): number => project.toFunction.length + project.toGemini.length;

test("the built-in reader is the default, and with Gemini chosen nothing is read or sent until the box is ticked", options, async () => {
  await freshAudit("answer");
  assert.equal(await isTicked(BUILT_IN_CHOICE), true);
  assert.equal(await exists(CONSENT_BOX), false, "no box to tick while the built-in reader is chosen");

  await chooseGemini(false);
  assert.equal(await isTicked(CONSENT_BOX), false, "the box starts empty");
  const text = await pageText(page);
  assert.match(text, /text of the contract.s pages goes to Google Gemini/);
  assert.match(text, /claims file is never sent/);
  await shot(page, "1-choose-the-reader");

  await clickButton(page, "Try the sample");
  await pause(600);
  assert.match(await pageText(page), /Tick the box below to agree/);
  await chooseFile(page, files.pdf);
  await pause(800);
  const after = await pageText(page);
  assert.match(after, /Tick the box below to agree/);
  assert.match(after, /Step 2 of 4: Review contract terms , not available yet/);
  assert.equal(sentAnything(), 0, "nothing left the browser");
});

test("Gemini reads an uploaded PDF: only page text is sent, and every term waits for a person", options, async () => {
  await freshAudit("answer");
  await chooseGemini(true);
  await chooseFile(page, files.pdf);
  assert.ok(await waitForText(page, "terms confirmed"), "the review step opens");
  await pause(300);

  // What left the browser, and what the function sent on.
  assert.equal(project.toFunction.length, 1);
  const sent = JSON.parse(project.toFunction[0]) as { task: string; documentPages: number; pages: Record<string, unknown>[] };
  assert.deepEqual(Object.keys(sent).sort(), ["documentPages", "pages", "task"]);
  assert.equal(sent.pages.length, 12);
  for (const p of sent.pages) assert.deepEqual(Object.keys(p).sort(), ["page", "text"]);
  assert.doesNotMatch(project.toFunction[0], /Harborview-upload|reviewer@example\.com/, "neither the file's name nor who is asking");
  assert.ok(!project.toFunction[0].includes(TEST_KEY), "the browser has no key to send");
  const toGoogle = JSON.parse(project.toGemini[0]) as { store?: unknown };
  assert.equal(toGoogle.store, false, "Google is told not to store the request");
  assert.equal(project.geminiHeaders[0].get("x-goog-api-key"), TEST_KEY, "the key is added by the function, on the server");
  assert.doesNotMatch(project.toGemini[0], /Harborview-upload|reviewer@example\.com/);

  // The terms: read from the PDF's own text, marked, and all unconfirmed.
  const text = await pageText(page);
  assert.match(text, /Gemini read this contract/);
  assert.match(text, /Nothing is confirmed yet/);
  const rows = await termRows(page);
  assert.ok(rows.length >= 18, `${rows.length} terms`);
  assert.ok(rows.every((row) => !row.confirmed), "nothing arrives confirmed");
  assert.ok(rows.every((row) => row.text.includes("Read by Gemini")));
  const flagged = rows.filter((row) => row.text.includes("Needs review"));
  assert.ok(flagged.length >= 2, "terms that failed a check are marked");
  await shot(page, "2-review-the-terms");

  // Confirming the clear ones in one go leaves the marked ones for a person.
  await clickButton(page, "Confirm all high confidence", "starting");
  await pause(300);
  const afterBulk = await termRows(page);
  assert.ok(afterBulk.filter((row) => row.confirmed).length >= 8);
  assert.ok(afterBulk.filter((row) => row.text.includes("Needs review")).every((row) => !row.confirmed));

  // A marked term says what is wrong and shows the wording it was checked against.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("li")].find((li) => li.innerText.includes("Monthly reports") && li.querySelector('input[type="checkbox"]'));
    [...(row?.querySelectorAll("button") ?? [])].find((b) => /wording/i.test(b.textContent ?? ""))?.click();
  });
  assert.ok(await waitForText(page, "Look closely before confirming", 5_000));
  const panel = await page.evaluate(() => (document.querySelector('[role="dialog"]') as HTMLElement).innerText.replace(/\s+/g, " "));
  assert.match(panel, /The figure 25 was not found in the quoted wording/);
  assert.match(panel, /within twenty \(20\) days after the end of each month/);
  assert.match(panel, /Checked: this wording is on page 9 of the PDF/);
  await shot(page, "3-a-term-that-needs-review");
  await page.keyboard.press("Escape");
});

test("a dense contract is asked about in smaller parts until it is read in full, and a page that may still be incomplete is named", options, async () => {
  // Page 1 states 3 fees and page 2 states 100. One answer holds 80.
  const schedule = feeSchedule(2, (number) => (number === 2 ? 100 : 3));
  const pdf = writePdf(path.join(folder, "Fee-schedule.pdf"), schedule.pages);
  await freshAudit("answer");
  project.answer = (pages) => schedule.answerFor(pages, { obeysLimit: DEFAULT_LIMITS.maxTerms });
  try {
    await chooseGemini(true);
    await chooseFile(page, pdf);
    assert.ok(await waitForText(page, "terms confirmed"), "the review step opens");
    await pause(300);

    // Both pages together reached the limit, so each was asked about again by itself.
    assert.deepEqual(
      project.toFunction.map((body) => (JSON.parse(body) as { pages: { page: number }[] }).pages.map((p) => p.page)),
      [[1, 2], [1], [2]],
    );
    const text = await pageText(page);
    assert.match(text, new RegExp(`0 of ${3 + DEFAULT_LIMITS.maxTerms} terms confirmed`), "all of page 1, and as much of page 2 as one answer holds");
    assert.match(text, /Page 2 may hold more terms/);
    assert.match(text, /On page 2, Gemini reached the most terms it reports for a single page/);
    assert.match(text, /add what is missing with Add a term/);
    await shot(page, "4-a-page-that-may-hold-more");
  } finally {
    project.answer = null;
  }
});

test("when Gemini fails the audit stops, and asking again needs the agreement to still stand", options, async () => {
  await freshAudit("busy");
  await chooseGemini(true);
  await chooseFile(page, files.pdf);
  assert.ok(await waitForText(page, "Gemini could not read Harborview-upload.pdf"));
  const text = await pageText(page);
  // The words come from the function's own answer, so the browser was allowed to read a failed answer.
  assert.match(text, /Gemini is receiving too many requests right now/);
  assert.match(text, /Nothing has been read in its place/);
  assert.match(text, /Try Gemini again/);
  assert.match(text, /Use the built-in reader instead/);
  assert.match(text, /Step 2 of 4: Review contract terms , not available yet/);
  assert.doesNotMatch(text, /terms found|terms confirmed/, "the built-in reader did not step in");
  assert.equal(project.toFunction.length, 1, "the app asked once");
  assert.equal(project.toGemini.length, 2, "the function did the retrying");
  await shot(page, "5-gemini-could-not-read");

  // Gemini recovers, but the person has unticked the box in the meantime.
  project.mode = "answer";
  project.forget();
  await page.click(CONSENT_BOX);
  await clickButton(page, "Try Gemini again");
  await pause(1_200);
  assert.equal(sentAnything(), 0, "nothing is sent once the agreement is withdrawn");
  assert.match(await pageText(page), /To ask Gemini again, choose the Gemini reader below and tick the box to agree/);

  // The same when the other reader is chosen.
  await page.click(BUILT_IN_CHOICE);
  await clickButton(page, "Try Gemini again");
  await pause(800);
  assert.equal(sentAnything(), 0);

  await chooseGemini(true);
  await clickButton(page, "Try Gemini again");
  assert.ok(await waitForText(page, "terms confirmed"), "with the box ticked again, Gemini reads the contract");
  assert.equal(project.toFunction.length, 1);
});

test("the built-in reader takes over only when the person asks, and then nothing more is sent", options, async () => {
  await freshAudit("down");
  await chooseGemini(true);
  await chooseFile(page, files.pdf);
  assert.ok(await waitForText(page, "Gemini could not read Harborview-upload.pdf"));
  const before = sentAnything();

  await clickButton(page, "Use the built-in reader instead");
  assert.ok(await waitForText(page, "terms confirmed"));
  await pause(300);
  const text = await pageText(page);
  assert.doesNotMatch(text, /Read by Gemini|Gemini read this contract/);
  assert.match(text, /0 of \d+ terms confirmed/, "an uploaded contract's terms arrive unconfirmed from this reader too");
  assert.equal(sentAnything(), before);

  await clickButton(page, "Back");
  assert.ok(await waitForText(page, "terms found"));
  assert.doesNotMatch(await pageText(page), /Read by Gemini/);
});

test("a function that is not deployed, and a function with no key, are each named", options, async () => {
  await freshAudit("not-deployed");
  await chooseGemini(true);
  await chooseFile(page, files.pdf);
  assert.ok(await waitForText(page, "Gemini could not read Harborview-upload.pdf"));
  // The platform's "not found" has no cross-origin headers, so the browser hides it. The app works out the likely cause.
  assert.match(await pageText(page), /Most likely the extract-contract-terms function has not been deployed/);

  await freshAudit("no-key");
  await chooseGemini(true);
  await chooseFile(page, files.pdf);
  assert.ok(await waitForText(page, "Gemini could not read Harborview-upload.pdf"));
  const text = await pageText(page);
  assert.match(text, /GEMINI_API_KEY secret of the Edge Function has not been set/);
  assert.doesNotMatch(text, /Try Gemini again/, "asking again cannot help, so it is not offered");
  assert.match(text, /Use the built-in reader instead/);
  assert.equal(project.toGemini.length, 0, "nothing was sent to Google without a key");
});

test("Cancel stops a reading, the late answer is not used, and the agreement is withdrawn", options, async () => {
  await freshAudit("slow");
  await chooseGemini(true);
  await chooseFile(page, files.pdf);
  assert.ok(await waitForText(page, "Gemini is reading the contract", 10_000));
  await clickButton(page, "Cancel");
  await pause(3_500); // longer than the stand-in takes to answer
  const text = await pageText(page);
  assert.match(text, /Who reads the contract/);
  assert.doesNotMatch(text, /terms found|terms confirmed|Gemini could not read/);
  assert.equal(await isTicked(GEMINI_CHOICE), true);
  assert.equal(await isTicked(CONSENT_BOX), false, "the next file needs the box ticked again");
});

test("a whole audit from uploaded files: the same money result, nothing sent while claims are checked, and a report that says what Gemini did", options, async () => {
  await freshAudit("answer");
  const savedBefore = project.rows.length;
  await chooseGemini(true);
  await chooseFile(page, files.pdf);
  assert.ok(await waitForText(page, "terms confirmed"));
  await pause(300);
  await clickButton(page, "Confirm all high confidence", "starting");
  await pause(300);
  await clickButton(page, "Continue");

  assert.ok(await waitForText(page, "Upload claims"));
  assert.match(await pageText(page), /never sent to Gemini/);
  await chooseFile(page, files.csv);
  assert.ok(await waitForText(page, "All 300 rows are ready"));
  await clickButton(page, "Continue");

  assert.ok(await waitForText(page, "Check what will be used"));
  const runStep = await pageText(page);
  assert.match(runStep, /Read by Google Gemini \(gemini-3\.8-flash\)/);
  assert.match(runStep, /Nothing more is sent to Gemini/);
  await shot(page, "6-before-the-run");

  const sentBeforeRun = sentAnything();
  await clickButton(page, "Run audit");
  assert.ok(await waitForText(page, "read this contract"), "the report opens");
  assert.match(page.url(), /#\/reports\//);
  assert.equal(sentAnything(), sentBeforeRun, "checking the claims sent nothing");
  assert.doesNotMatch([...project.toFunction, ...project.toGemini].join("\n"), CLAIMS_DATA, "nothing from the claims file ever left the browser");
  assert.equal(project.rows.length, savedBefore + 1, "the report was saved to the account");

  const report = await pageText(page);
  assert.match(report, /Google Gemini \(gemini-3\.8-flash\) read this contract/);
  assert.match(report, /It is not legal advice/);
  assert.match(report, /\$33,116\.41/, "the six money checks give what they give without Gemini");
  assert.match(report, /From 6 findings of the money checks/);
  assert.match(report, /4 observations from Gemini.s reading have no estimate and add nothing here/);
  assert.match(report, /No estimate/);
  await pause(1_200); // the chart is loaded after the rest
  await shot(page, "7-the-report");

  // An observation explains itself and shows the wording it was checked against.
  await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("li button")].find((b) => b.innerText.includes("AI reading"))?.click());
  assert.ok(await waitForText(page, "What Gemini noticed", 5_000));
  const finding = await page.evaluate(() => (document.querySelector('[role="dialog"]') as HTMLElement).innerText.replace(/\s+/g, " "));
  assert.match(finding, /An observation from Gemini/);
  assert.match(finding, /no dollar estimate/);
  assert.match(finding, /Checked: each quotation is on the stated page of the contract/);
  await shot(page, "8-an-observation");
  await page.keyboard.press("Escape");
  await pause(300);

  // The PDF report is made in the browser. Catch what it would save.
  await page.evaluate(() => {
    const kept: Blob[] = [];
    (window as unknown as { savedBlobs: Blob[] }).savedBlobs = kept;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource): string => {
      if (object instanceof Blob) kept.push(object);
      return create(object);
    };
  });
  await clickButton(page, "Download PDF");
  await page.waitForFunction(() => (window as unknown as { savedBlobs: Blob[] }).savedBlobs.length > 0, { timeout: 30_000 });
  const pdf = await page.evaluate(async () => {
    const bytes = new Uint8Array(await (window as unknown as { savedBlobs: Blob[] }).savedBlobs[0].arrayBuffer());
    return { size: bytes.length, start: String.fromCharCode(...bytes.slice(0, 5)) };
  });
  assert.equal(pdf.start, "%PDF-");
  assert.ok(pdf.size > 5_000);
  assert.equal(sentAnything(), sentBeforeRun, "nor did the report or its PDF send anything");

  // The next audit asks again.
  await page.goto(`${app.origin}/#/audit/new`, { waitUntil: "networkidle0" });
  assert.ok(await waitForText(page, "Who reads the contract"));
  assert.equal(await isTicked(GEMINI_CHOICE), true, "the choice of reader is remembered for the session");
  assert.equal(await isTicked(CONSENT_BOX), false, "the agreement is not");
});

test("Settings can check the reader, and sends no contract text to do it", options, async () => {
  project.mode = "answer";
  await page.goto(`${app.origin}/#/settings`, { waitUntil: "networkidle0" });
  assert.ok(await waitForText(page, "Check the Gemini reader"));
  project.forget();

  await clickButton(page, "Check AI reader");
  assert.ok(await waitForText(page, "Ready. The function reached Gemini and will use the model gemini-3.8-flash"));
  await shot(page, "9-settings-check");
  assert.deepEqual(project.toFunction.map((body) => JSON.parse(body) as unknown), [{ task: "status" }]);
  assert.doesNotMatch(project.toGemini.join("\n"), /Harborview|Administrator/, "no contract text is involved");

  project.mode = "no-key";
  await clickButton(page, "Check AI reader");
  assert.ok(await waitForText(page, "GEMINI_API_KEY secret of the Edge Function has not been set"));

  project.mode = "not-deployed";
  await clickButton(page, "Check AI reader");
  assert.ok(await waitForText(page, "Most likely the extract-contract-terms function has not been deployed"));
});

test("a build that does not ask for the Gemini reader does not offer it, and says how to turn it on", options, async () => {
  project.forget();
  await signIn(plainApp.origin);
  await page.goto(`${plainApp.origin}/#/audit/new`, { waitUntil: "networkidle0" });
  assert.ok(await waitForText(page, "Drag and drop your contract PDF here"));
  const upload = await pageText(page);
  assert.doesNotMatch(upload, /Who reads the contract|Gemini/, "the first step is as it was before the Gemini reader");
  assert.equal(await exists(GEMINI_CHOICE), false);

  // The sample is read by the built-in reader, on the device.
  await clickButton(page, "Try the sample");
  assert.ok(await waitForText(page, "terms confirmed"));
  assert.doesNotMatch(await pageText(page), /Read by Gemini/);
  assert.equal(sentAnything(), 0, "nothing was sent to the function");

  await page.goto(`${plainApp.origin}/#/settings`, { waitUntil: "networkidle0" });
  assert.ok(await waitForText(page, "Off in this build"));
  const settings = await pageText(page);
  assert.match(settings, /VITE_ANALYZER_MODE=gemini/);
  assert.doesNotMatch(settings, /Check AI reader/);
  await shot(page, "10-reader-turned-off");
});

test("the browser reported no errors of its own along the way", options, () => {
  assert.deepEqual(problems, []);
});
