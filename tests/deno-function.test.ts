/**
 * The real entry file, supabase/functions/extract-contract-terms/index.ts, run by the real Deno
 * runtime and reached over real HTTP. Only Google and the Supabase Auth server are stand-ins,
 * served from this process on 127.0.0.1.
 *
 * It needs a `deno` binary. Without one the tests are skipped, and say so. To run them:
 *   - install Deno (https://deno.com), or `npm i --no-save deno`, or
 *   - set DENO_BIN to the path of a binary.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { GeminiAnalyzer, type AiTransport } from "../src/analyzer/gemini";
import { SAMPLE_PAGES } from "../src/data/sample";
import { isOnPage, makeWire } from "./helpers/client";
import { sampleModelAnswerFor } from "./helpers/sampleAnswer";
import { interaction, TEST_KEY, USER_ID, USER_TOKEN } from "./helpers/stubs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENTRY = path.join(ROOT, "supabase/functions/extract-contract-terms/index.ts");
const CONFIG = path.join(ROOT, "supabase/functions/extract-contract-terms/deno.json");

function findDeno(): string | null {
  const candidates = [process.env.DENO_BIN, path.join(ROOT, "node_modules/.bin/deno"), "deno"].filter((c): c is string => Boolean(c));
  for (const candidate of candidates) {
    if (candidate !== "deno" && !existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return null;
}

const DENO = findDeno();
const skip = DENO ? false : "no deno binary was found (install Deno, or set DENO_BIN)";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

let standIn: Server;
let fn: ChildProcess;
let functionUrl = "";
const toGemini: Seen[] = [];
const toAuth: Seen[] = [];
let functionOutput = "";
/** What the Gemini stand-in does with the next calls. */
let geminiMode: "answer" | "busy" = "answer";

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

before(async () => {
  if (!DENO) return;

  // One server plays both services the function talks to.
  standIn = createServer((req, res) => {
    void (async () => {
      const seen: Seen = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: await readBody(req) };
      const json = (status: number, body: unknown): void => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (seen.url.startsWith("/auth/v1/user")) {
        toAuth.push(seen);
        if (seen.headers.authorization === `Bearer ${USER_TOKEN}`) return json(200, { id: USER_ID, aud: "authenticated", role: "authenticated" });
        return json(401, { code: 401, msg: "invalid JWT" });
      }
      if (seen.url.endsWith("/interactions") && seen.method === "POST") {
        toGemini.push(seen);
        if (geminiMode === "busy") return json(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded." } });
        const input = String((JSON.parse(seen.body) as { input?: unknown }).input ?? "");
        const pages = [...input.matchAll(/<<<BEGIN PAGE (\d+) /g)].map((m) => Number(m[1]));
        return json(200, interaction(pages.length > 0 ? JSON.stringify(sampleModelAnswerFor(pages)) : "ready"));
      }
      return json(404, { error: "the stand-in does not know this address" });
    })();
  });
  await new Promise<void>((resolve) => standIn.listen(0, "127.0.0.1", resolve));
  const standInUrl = `http://127.0.0.1:${(standIn.address() as AddressInfo).port}`;

  const port = await freePort();
  functionUrl = `http://127.0.0.1:${port}/functions/v1/extract-contract-terms`;
  fn = spawn(
    DENO,
    // --no-remote: the function must not need anything from the network to start.
    ["run", "--no-prompt", "--no-remote", "--allow-net=127.0.0.1", "--allow-env", "--config", CONFIG, ENTRY],
    {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        DENO_DIR: process.env.DENO_DIR,
        NO_COLOR: "1",
        DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}`,
        // What `supabase secrets set` and the platform provide in production.
        GEMINI_API_KEY: TEST_KEY,
        GEMINI_MODEL: "gemini-3.8-flash",
        GEMINI_API_BASE_URL: standInUrl,
        GEMINI_MAX_RETRIES: "1",
        SUPABASE_URL: standInUrl,
        SUPABASE_ANON_KEY: "anon-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  fn.stdout?.on("data", (c: Buffer) => (functionOutput += c.toString("utf8")));
  fn.stderr?.on("data", (c: Buffer) => (functionOutput += c.toString("utf8")));

  // Wait until it answers.
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (fn.exitCode !== null) throw new Error(`the function stopped while starting:\n${functionOutput}`);
    try {
      await fetch(functionUrl, { method: "OPTIONS" });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`the function did not start listening:\n${functionOutput}`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
});

after(async () => {
  fn?.kill("SIGKILL");
  await new Promise<void>((resolve) => (standIn ? standIn.close(() => resolve()) : resolve()));
});

interface CallOptions {
  token?: string | null;
  body?: unknown;
}

async function call({ token = USER_TOKEN, body = { task: "status" } }: CallOptions = {}): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: "sb_publishable_test" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(functionUrl, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as Record<string, unknown>, text };
}

test("under Deno: a signed-in user's status check reaches Gemini with the server's key", { skip }, async () => {
  toGemini.length = 0;
  const res = await call();
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, model: "gemini-3.8-flash" });

  assert.equal(toGemini.length, 1);
  const sent = toGemini[0];
  assert.equal(sent.url, "/v1beta/interactions");
  assert.equal(sent.headers["x-goog-api-key"], TEST_KEY, "the key goes to Gemini in the header");
  assert.equal(sent.headers["api-revision"], "2026-05-20");
  const body = JSON.parse(sent.body) as Record<string, unknown>;
  assert.equal(body.model, "gemini-3.8-flash");
  assert.equal(body.store, false, "Gemini is told not to store the request");
  assert.equal(res.text.includes(TEST_KEY), false, "the key never comes back to the caller");
});

test("under Deno: no session, no Gemini", { skip }, async () => {
  toGemini.length = 0;
  for (const token of [null, "not-a-real-session"]) {
    const res = await call({ token, body: { task: "extract", pages: [{ page: 1, text: SAMPLE_PAGES[0].text }] } });
    assert.equal(res.status, 401);
    assert.equal((res.body.error as { code: string }).code, "unauthorized");
  }
  assert.equal(toGemini.length, 0, "nothing was sent to Gemini for a caller who is not signed in");
});

test("under Deno: the app's analyzer reads the sample through the function over real HTTP", { skip }, async () => {
  toGemini.length = 0;
  const transport: AiTransport = async (body, signal) => {
    const res = await fetch(functionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${USER_TOKEN}`, apikey: "sb_publishable_test" },
      body: JSON.stringify(body),
      signal,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const analyzer = new GeminiAnalyzer(transport);
  const terms = await analyzer.extractTerms(SAMPLE_PAGES);

  // The same reading as the handler gives in-process under Node.
  const expected = await new GeminiAnalyzer(makeWire().transport).extractTerms(SAMPLE_PAGES);
  assert.deepEqual(terms, expected);
  assert.ok(terms.length >= 18);
  for (const t of terms) {
    assert.equal(t.confirmed, false);
    assert.ok(isOnPage(SAMPLE_PAGES, t.pageRef, t.snippet));
  }

  // What went to Gemini: the page text, fenced, with the instructions and the schema. Nothing about the user.
  assert.equal(toGemini.length, 1);
  const body = JSON.parse(toGemini[0].body) as Record<string, unknown>;
  assert.equal(body.store, false);
  assert.equal(typeof body.system_instruction, "string");
  assert.equal((body.response_format as { mime_type?: string }).mime_type, "application/json");
  assert.ok(String(body.input).includes(SAMPLE_PAGES[3].text));
  assert.equal(toGemini[0].body.includes(USER_ID), false);
  assert.equal(toGemini[0].body.includes(USER_TOKEN), false);
});

test("under Deno: when Gemini stays too busy, the caller gets a clear error it can retry", { skip }, async () => {
  geminiMode = "busy";
  try {
    const res = await call({ body: { task: "extract", pages: [{ page: 4, text: SAMPLE_PAGES[3].text }] } });
    assert.equal(res.status, 429);
    const error = res.body.error as { code: string; retryable: boolean; message: string };
    assert.equal(error.code, "rate_limited");
    assert.equal(error.retryable, true);
    assert.equal(res.text.includes(TEST_KEY), false);
    assert.equal(res.text.includes("Quota exceeded"), false, "Google's own error text is not passed on");
  } finally {
    geminiMode = "answer";
  }
});

test("under Deno: the function's log holds no key, no session token and no contract text", { skip }, async () => {
  assert.ok(functionOutput.includes('"event":"ai_request"'), "requests are logged");
  assert.equal(functionOutput.includes(TEST_KEY), false);
  assert.equal(functionOutput.includes(USER_TOKEN), false);
  for (const page of SAMPLE_PAGES) assert.equal(functionOutput.includes(page.text.slice(0, 60)), false, `text of page ${page.page} is in the log`);
  assert.equal(/administrative fee of \$24\.50/i.test(functionOutput), false);
});
