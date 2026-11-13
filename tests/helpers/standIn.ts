/**
 * A stand-in for a Supabase project, for driving the built app in a real browser: the Auth
 * server, the `audits` table and the Edge Function, on 127.0.0.1.
 *
 * The Edge Function is the real handler. Only Google behind it is a stand-in, which answers with
 * the prepared reading of the sample agreement. The Auth server and the table are simple copies
 * that do what the app needs and no more.
 *
 * The app is served from a second address, so every call the app makes crosses origins the way it
 * does in production, and the browser enforces the cross-origin rules on the function's answers.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHandler } from "../../supabase/functions/_shared/handler.ts";
import { sampleModelAnswerFor } from "./sampleAnswer";
import { interaction, TEST_KEY } from "./stubs";

/**
 * What happens to the next requests.
 *   answer        Gemini reads the pages
 *   busy          Gemini answers 429 every time
 *   down          Gemini answers 503 every time
 *   slow          Gemini takes a few seconds, then reads the pages
 *   no-key        the function has no GEMINI_API_KEY
 *   not-deployed  the function does not exist: the platform answers 404 with no cross-origin headers
 */
export type StandInMode = "answer" | "busy" | "down" | "slow" | "no-key" | "not-deployed";

export const STAND_IN_USER = { email: "reviewer@example.com", password: "correct horse battery staple" };
export const STAND_IN_PUBLISHABLE_KEY = "sb_publishable_browser_test";

export interface StandIn {
  /** The project's address: what VITE_SUPABASE_URL is set to when the app is built. */
  origin: string;
  mode: StandInMode;
  /** The body of every POST that reached the function, and of every request the function made to Gemini. */
  toFunction: string[];
  toGemini: string[];
  /** The headers of every request the function made to Gemini, for checking where the key goes. */
  geminiHeaders: Headers[];
  /** The rows of the `audits` table. */
  rows: Record<string, unknown>[];
  /** When set, what Gemini answers for a request holding these pages, in place of the reading of the sample agreement. */
  answer: ((pages: number[]) => unknown) | null;
  /** Forgets the requests seen so far. */
  forget(): void;
  close(): Promise<void>;
}

const USER = {
  id: "3f1c2b9e-5d7a-4c1e-9a55-0b8f6d2e7a11",
  aud: "authenticated",
  role: "authenticated",
  email: STAND_IN_USER.email,
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

const listen = (server: Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });

const close = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

export async function startStandIn(): Promise<StandIn> {
  const tokens = new Set<string>();
  let origin = "";

  const standIn: StandIn = {
    origin: "",
    mode: "answer",
    toFunction: [],
    toGemini: [],
    geminiHeaders: [],
    rows: [],
    answer: null,
    forget() {
      this.toFunction.length = 0;
      this.toGemini.length = 0;
      this.geminiHeaders.length = 0;
    },
    close: () => close(server),
  };

  const handler = createHandler({
    geminiApiKey: () => (standIn.mode === "no-key" ? undefined : TEST_KEY),
    env: (name) => ({ SUPABASE_URL: origin, SUPABASE_ANON_KEY: STAND_IN_PUBLISHABLE_KEY, GEMINI_MAX_RETRIES: "1" })[name],
    fetch: async (input, init) => {
      const headers = new Headers(init.headers);
      // The function asks the Auth server who the caller is.
      if (input.startsWith(`${origin}/auth/v1/user`)) {
        const bearer = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
        return tokens.has(bearer) ? Response.json(USER) : Response.json({ code: 401, msg: "invalid JWT" }, { status: 401 });
      }
      // Everything else the function sends goes to Google.
      const body = typeof init.body === "string" ? init.body : "";
      standIn.toGemini.push(body);
      standIn.geminiHeaders.push(headers);
      if (standIn.mode === "busy") return Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded." } }, { status: 429 });
      if (standIn.mode === "down") return Response.json({ error: { code: 503, status: "UNAVAILABLE" } }, { status: 503 });
      if (standIn.mode === "slow") await new Promise((resolve) => setTimeout(resolve, 2_500));
      const sent = String((JSON.parse(body) as { input?: unknown }).input ?? "");
      const pages = [...sent.matchAll(/<<<BEGIN PAGE (\d+) /g)].map((m) => Number(m[1]));
      if (pages.length === 0) return Response.json(interaction("ready"));
      return Response.json(interaction(JSON.stringify(standIn.answer ? standIn.answer(pages) : sampleModelAnswerFor(pages))));
    },
    log: () => undefined,
    sleep: async () => undefined,
  });

  /** The cross-origin headers Supabase's own Auth server and table API send. The function sends its own. */
  const cors = (req: IncomingMessage): Record<string, string> => ({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": String(req.headers["access-control-request-headers"] ?? "authorization, apikey, content-type"),
    "Access-Control-Expose-Headers": "Content-Range",
  });
  const send = (req: IncomingMessage, res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void => {
    res.writeHead(status, { "Content-Type": "application/json", ...cors(req), ...headers });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };

  /** `id=eq.x&user_id=neq.y` against the rows. */
  const matching = (url: URL): Record<string, unknown>[] => {
    let found = standIn.rows;
    for (const [key, value] of url.searchParams) {
      const m = /^(eq|neq)\.(.*)$/.exec(value);
      if (!m || ["select", "order", "limit", "offset", "columns"].includes(key)) continue;
      found = found.filter((row) => (m[1] === "eq" ? String(row[key]) === m[2] : String(row[key]) !== m[2]));
    }
    return found;
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", origin);
      const p = url.pathname;
      const body = await readBody(req);

      if (p.startsWith("/functions/v1/")) {
        if (standIn.mode === "not-deployed" || p !== "/functions/v1/extract-contract-terms") {
          // As the platform answers for a function that does not exist: no cross-origin headers at all.
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ code: "NOT_FOUND", message: "Requested function was not found" }));
          return;
        }
        if (req.method === "POST") standIn.toFunction.push(body.toString("utf8"));
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
        const answer = await handler(new Request(`${origin}${p}`, { method: req.method, headers, ...(req.method === "POST" ? { body: body.toString("utf8") } : {}) }));
        const out: Record<string, string> = {};
        answer.headers.forEach((v, k) => (out[k] = v));
        res.writeHead(answer.status, out);
        res.end(Buffer.from(await answer.arrayBuffer()));
        return;
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204, cors(req));
        res.end();
        return;
      }

      if (p === "/auth/v1/token") {
        const now = Math.floor(Date.now() / 1000);
        const access = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, aud: "authenticated", role: "authenticated", email: USER.email, exp: now + 3600, iat: now })}.${b64(tokens.size)}`;
        tokens.add(access);
        return send(req, res, 200, { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: `refresh-${tokens.size}`, user: USER });
      }
      if (p === "/auth/v1/user") {
        const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
        return tokens.has(bearer) ? send(req, res, 200, USER) : send(req, res, 401, { code: 401, msg: "invalid JWT" });
      }
      if (p === "/auth/v1/logout") return send(req, res, 204);

      if (p === "/rest/v1/audits") {
        const prefer = String(req.headers.prefer ?? "");
        if (req.method === "GET" || req.method === "HEAD") {
          const found = [...matching(url)].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
          const page = found.slice(0, Number(url.searchParams.get("limit") ?? found.length));
          return send(req, res, 200, page, { "Content-Range": `${page.length > 0 ? `0-${page.length - 1}` : "*"}/${found.length}` });
        }
        if (req.method === "POST") {
          const incoming = JSON.parse(body.toString("utf8")) as Record<string, unknown> | Record<string, unknown>[];
          for (const row of Array.isArray(incoming) ? incoming : [incoming]) {
            if (standIn.rows.some((r) => r.id === row.id)) return send(req, res, 409, { code: "23505", message: "duplicate key value violates unique constraint" });
            standIn.rows.push({ updated_at: new Date().toISOString(), ...row });
          }
          return send(req, res, 201);
        }
        if (req.method === "PATCH") {
          const found = matching(url);
          for (const row of found) Object.assign(row, JSON.parse(body.toString("utf8")) as Record<string, unknown>);
          return prefer.includes("return=representation") ? send(req, res, 200, found.map((row) => ({ id: row.id }))) : send(req, res, 204);
        }
        if (req.method === "DELETE") {
          const found = new Set(matching(url));
          standIn.rows = standIn.rows.filter((row) => !found.has(row));
          return send(req, res, 204, undefined, { "Content-Range": `*/${found.size}` });
        }
      }
      send(req, res, 404, { message: `the stand-in has no ${req.method} ${p}` });
    })().catch((err) => {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(err));
    });
  });

  origin = `http://127.0.0.1:${await listen(server)}`;
  standIn.origin = origin;
  return standIn;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};

/** Serves a built copy of the app from its own address. */
export async function serveFolder(folder: string): Promise<{ origin: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    void (async () => {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      const file = path.join(folder, path.normalize(pathname === "/" ? "index.html" : pathname));
      if (!file.startsWith(folder)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const data = await readFile(file);
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
        res.end(data);
      } catch {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(await readFile(path.join(folder, "index.html")));
      }
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const port = await listen(server);
  return { origin: `http://127.0.0.1:${port}`, close: () => close(server) };
}
