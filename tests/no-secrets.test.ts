/**
 * The Gemini key belongs to the server. These tests fail if the web app's source, its build
 * settings, or a built bundle ever holds a key, the name of the key, or a way to call Google
 * directly.
 *
 * The bundle scan covers `dist/` when it exists, so run `npm run build` first for the full check.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

/** Things that must never be in code the browser receives. */
const FORBIDDEN: [string, RegExp][] = [
  ["the name of the server's key", /GEMINI_API_KEY/],
  ["a Gemini setting exposed to the browser", /VITE_[A-Z_]*GEMINI|VITE_[A-Z_]*GOOGLE|VITE_[A-Z_]*API_KEY/],
  ["the header that carries the key", /x-goog-api-key/i],
  ["Google's API address", /generativelanguage\.googleapis\.com/i],
  ["something shaped like a Google API key", /AIza[0-9A-Za-z_-]{30,}/],
  ["a Supabase secret key", /sb_secret_[0-9A-Za-z_-]{8,}/],
  ["a direct call to the Interactions API", /\/v1(?:beta)?\/interactions/],
];

function scan(files: string[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|pdf|map)$/i.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const [what, pattern] of FORBIDDEN) {
      if (pattern.test(text)) problems.push(`${path.relative(ROOT, file)}: ${what}`);
    }
  }
  return problems;
}

test("the web app's source holds no key, no key name and no way to call Google directly", () => {
  const files = [...filesUnder(path.join(ROOT, "src")), ...filesUnder(path.join(ROOT, "public")), path.join(ROOT, "index.html"), path.join(ROOT, "vite.config.ts")].filter(existsSync);
  assert.ok(files.length > 50, "the source was found");
  assert.deepEqual(scan(files), []);
});

test("the web app only imports the shared files that are safe for a browser", () => {
  const allowed = new Set(["categories.ts", "evidence.ts", "limits.ts", "wire.ts"]);
  const problems: string[] = [];
  for (const file of filesUnder(path.join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/from\s+["']([^"']*supabase\/functions\/[^"']*)["']/g)) {
      const target = m[1];
      const name = path.basename(target);
      if (!target.includes("/_shared/") || !allowed.has(name)) problems.push(`${path.relative(ROOT, file)} imports ${target}`);
    }
  }
  assert.deepEqual(problems, [], "the prompt, the schema, the Gemini client and the handler stay on the server");

  // And those four files do not reach the others either.
  for (const name of allowed) {
    const text = readFileSync(path.join(ROOT, "supabase/functions/_shared", name), "utf8");
    for (const m of text.matchAll(/from\s+["']\.\/([^"']+)["']/g)) assert.ok(allowed.has(m[1]), `${name} imports ${m[1]}`);
  }
});

test("the key is read in exactly one place, on the server", () => {
  const readers = filesUnder(path.join(ROOT, "supabase/functions"))
    .filter((f) => /\.ts$/.test(f))
    .filter((f) => /Deno\.env\.get\(\s*["']GEMINI_API_KEY["']\s*\)/.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(readers, ["supabase/functions/extract-contract-terms/index.ts"]);
});

test("the committed templates hold placeholders only, and real env files are ignored by git", () => {
  const template = readFileSync(path.join(ROOT, "supabase/functions/.env.example"), "utf8");
  const key = /^GEMINI_API_KEY=(.*)$/m.exec(template)?.[1] ?? "";
  assert.equal(key, "YOUR_GEMINI_API_KEY_HERE");
  assert.equal(/AIza[0-9A-Za-z_-]{30,}/.test(template), false);

  // Everything in the web app's env template ends up in the browser. It may hold the switch that
  // offers the Gemini reader. It may not hold a Gemini key, or any setting named after Gemini.
  const root = readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.equal(/^[#\s]*[A-Za-z0-9_]*GEMINI[A-Za-z0-9_]*\s*=/im.test(root), false, "no setting of the web app is named after Gemini");
  assert.equal(/GEMINI_API_KEY|AIza[0-9A-Za-z_-]{30,}/.test(root), false, "the web app's env template names no Gemini key and holds none");
  assert.equal(/^[#\s]*VITE_ANALYZER_MODE=(.*)$/m.exec(root)?.[1], "gemini", "the switch is there, and it is a word, not a key");

  const ignored = (file: string): boolean => {
    try {
      execFileSync("git", ["check-ignore", "-q", file], { cwd: ROOT });
      return true;
    } catch {
      return false;
    }
  };
  for (const file of [".env", ".env.local", "supabase/functions/.env", "supabase/functions/.env.local", "supabase/.env"]) {
    assert.equal(ignored(file), true, `${file} must be ignored by git`);
  }
  for (const file of [".env.example", "supabase/functions/.env.example"]) assert.equal(ignored(file), false, `${file} is a template and stays tracked`);

  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n");
  assert.deepEqual(
    tracked.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example")),
    [],
    "no real env file is tracked",
  );
});

test("a built bundle holds no key, no key name and no way to call Google directly", (t) => {
  const dist = path.join(ROOT, "dist");
  const files = filesUnder(dist);
  if (files.length === 0) {
    t.skip("there is no dist folder. Run `npm run build` first to include the bundle in this check.");
    return;
  }
  assert.deepEqual(scan(files), []);
});
