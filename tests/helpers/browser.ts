/**
 * What the browser test needs: a Chrome to drive, a few ways to act on a page as a person would,
 * and the sample agreement and claims as real files to upload.
 *
 * puppeteer-core is not a dependency of this project. It is loaded only if it is installed, and its
 * types are not needed: the small part of it that is used is described below.
 */

import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { jsPDF } from "jspdf";
import { SAMPLE_PAGES, generateSampleClaims } from "../../src/data/sample";

export interface ElementHandle {
  uploadFile(...paths: string[]): Promise<void>;
}

export interface Page {
  goto(url: string, options?: { waitUntil?: "load" | "networkidle0" }): Promise<unknown>;
  reload(options?: { waitUntil?: "load" | "networkidle0" }): Promise<unknown>;
  url(): string;
  evaluate<T, A extends unknown[]>(fn: (...args: A) => T | Promise<T>, ...args: A): Promise<T>;
  waitForFunction<A extends unknown[]>(fn: (...args: A) => unknown, options: { timeout?: number }, ...args: A): Promise<unknown>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  $(selector: string): Promise<ElementHandle | null>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  keyboard: { press(key: string): Promise<void> };
  on(event: "console", handler: (message: { type(): string; text(): string }) => void): unknown;
  on(event: "pageerror", handler: (error: Error) => void): unknown;
  on(event: "dialog", handler: (dialog: { accept(): Promise<void> }) => void): unknown;
}

export interface Browser {
  newPage(): Promise<Page>;
  close(): Promise<void>;
}

interface Puppeteer {
  launch(options: Record<string, unknown>): Promise<Browser>;
}

const WELL_KNOWN = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findChrome(): string | null {
  return [process.env.CHROME_BIN, ...WELL_KNOWN].find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate as string)) ?? null;
}

function hasPuppeteer(): boolean {
  try {
    createRequire(import.meta.url).resolve("puppeteer-core");
    return true;
  } catch {
    return false;
  }
}

/** Why the browser test cannot run here, or null when it can. */
export function whyNoBrowser(): string | null {
  if (!hasPuppeteer()) return "puppeteer-core is not installed (npm i --no-save puppeteer-core)";
  if (!findChrome()) return "no Chrome was found (set CHROME_BIN to a Chrome, Chromium or Edge binary)";
  return null;
}

/**
 * Starts the browser. CHROME_ARGS adds switches, separated by spaces (containers usually need
 * --no-sandbox). CHROME_HEADLESS_SHELL=1 is for the stripped-down "headless shell" builds.
 * Web security is left on, so the browser enforces the cross-origin rules as it does for users.
 */
export async function launchBrowser(): Promise<Browser> {
  const name = "puppeteer-core"; // not a literal, so the compiler does not look for its types
  const loaded = (await import(name)) as Puppeteer & { default?: Puppeteer };
  const puppeteer = loaded.default ?? loaded;
  return puppeteer.launch({
    executablePath: findChrome(),
    headless: process.env.CHROME_HEADLESS_SHELL ? "shell" : true,
    args: ["--no-first-run", "--disable-extensions", ...(process.env.CHROME_ARGS ?? "").split(/\s+/).filter(Boolean)],
    defaultViewport: { width: 1280, height: 900 },
  });
}

export const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Everything a person can read on the page, with runs of white space folded to one space. */
export const pageText = (page: Page): Promise<string> => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

/** Waits until the page shows this text. Answers false, rather than throwing, when it never does. */
export async function waitForText(page: Page, text: string, timeout = 30_000): Promise<boolean> {
  try {
    await page.waitForFunction((wanted: string) => document.body.innerText.replace(/\s+/g, " ").includes(wanted), { timeout }, text);
    return true;
  } catch {
    return false;
  }
}

/** Clicks the visible button whose label is exactly this text, or begins with it. */
export async function clickButton(page: Page, label: string, how: "exactly" | "starting" = "exactly"): Promise<void> {
  const clicked = await page.evaluate(
    (wanted: string, mode: string) => {
      const button = [...document.querySelectorAll("button")].find((b) => {
        const text = (b.textContent ?? "").replace(/\s+/g, " ").trim();
        return (mode === "exactly" ? text === wanted : text.startsWith(wanted)) && b.getClientRects().length > 0;
      });
      if (!button) return false;
      button.scrollIntoView({ block: "center", behavior: "instant" });
      button.click();
      return true;
    },
    label,
    how,
  );
  if (!clicked) throw new Error(`there is no button "${label}" on the page`);
}

/** Puts a file into the page's file input, as choosing it in the file picker does. */
export async function chooseFile(page: Page, file: string): Promise<void> {
  const input = await page.$('input[type="file"]');
  if (!input) throw new Error("there is no file input on the page");
  await input.uploadFile(file);
}

/** Whether each term in the review list is ticked as confirmed, with the text of its row. */
export const termRows = (page: Page): Promise<{ text: string; confirmed: boolean }[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll("li")]
      .filter((li) => li.querySelector('input[type="checkbox"]'))
      .map((li) => ({
        text: li.innerText.replace(/\s+/g, " "),
        confirmed: (li.querySelector('input[type="checkbox"]') as HTMLInputElement).checked,
      })),
  );

/**
 * Writes the sample agreement as a real, text-based PDF with one PDF page for each of its pages,
 * and the sample claims as a CSV. The app then reads them the way it reads a customer's files.
 */
export function writeSampleFiles(folder: string): { pdf: string; csv: string } {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  SAMPLE_PAGES.forEach((page, index) => {
    if (index > 0) doc.addPage();
    let y = 72;
    for (const paragraph of page.text.split(/\n+/)) {
      for (const line of doc.splitTextToSize(paragraph, 468) as string[]) {
        doc.text(line, 72, y);
        y += 15;
      }
      y += 8;
    }
  });
  const pdf = path.join(folder, "Harborview-upload.pdf");
  writeFileSync(pdf, Buffer.from(doc.output("arraybuffer")));

  const claims = generateSampleClaims() as unknown as Record<string, unknown>[];
  const columns = [...new Set(claims.flatMap((claim) => Object.keys(claim)))];
  const cell = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = path.join(folder, "claims.csv");
  writeFileSync(csv, [columns.join(","), ...claims.map((claim) => columns.map((column) => cell(claim[column])).join(","))].join("\n"));
  return { pdf, csv };
}
