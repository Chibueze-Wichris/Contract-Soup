/**
 * The request handler behind the `extract-contract-terms` Edge Function.
 *
 * Everything it needs from the outside (the environment, `fetch`, the clock, the log) is passed
 * in, so the same code runs unchanged in the function, under Deno, and in the Node tests.
 *
 * In order, a request has to get past:
 *   1. CORS, and the POST-only rule
 *   2. a signed-in user: the bearer token is checked with the project's own Auth server
 *   3. the size limits and the shape of the body (page text only, nothing else)
 * Only then is Gemini called, and its answer is checked against the page text before any of it
 * is returned.
 *
 * What is never written to the log: page text, quotations, anything the model wrote, the
 * Authorization header, the API key. Log entries hold counts, timings and short codes.
 */

import { buildInput, buildSystemInstruction, newBoundary } from "./prompt.ts";
import { UpstreamError, callGemini, type AttemptInfo, type FetchLike, type UpstreamCode } from "./gemini.ts";
import { geminiSettingsFromEnv, isUsableKey, limitsFromEnv, listFromEnv, type EnvReader, type GeminiSettings } from "./limits.ts";
import { buildResponseSchema } from "./schema.ts";
import { RequestError, interpretModelOutput, parseModelJson, validateRequest } from "./validate.ts";
import type { AiErrorBody, ExtractResponseBody, StatusResponseBody } from "./wire.ts";

export type LogEntry = Record<string, string | number | boolean | null>;

export interface HandlerDeps {
  /** Reads the Gemini API key. Kept apart from `env` so the entry file shows exactly where the key comes from. */
  geminiApiKey: () => string | undefined;
  env: EnvReader;
  fetch: FetchLike;
  log?: (entry: LogEntry) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";
const AUTH_TIMEOUT_MS = 10_000;
const MAX_TOKEN_LENGTH = 8_192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the browser is told when Gemini could not be used. Google's own wording is never passed on. */
const UPSTREAM: Record<UpstreamCode, { status: number; message: (s: GeminiSettings) => string }> = {
  key_rejected: { status: 502, message: () => "Gemini did not accept the server's API key. Check the GEMINI_API_KEY secret of the Edge Function." },
  model_unavailable: {
    status: 502,
    message: (s) => `The Gemini model "${s.model}" is not available to the server's API key. Check the GEMINI_MODEL setting.`,
  },
  precondition_failed: {
    status: 502,
    message: () => "Gemini refused the request because of how the API key's Google project is set up, or because the API is not offered where the server runs.",
  },
  rate_limited: { status: 429, message: () => "Gemini is receiving too many requests right now. Wait a moment and try again." },
  upstream_unavailable: { status: 502, message: () => "Gemini could not be reached or is having problems. Try again shortly." },
  upstream_timeout: { status: 504, message: () => "Gemini took too long to answer. Try again." },
  upstream_rejected: { status: 502, message: () => "Gemini rejected the request. Nothing was read." },
  bad_model_output: { status: 502, message: () => "Gemini's answer could not be used. Try again." },
  model_output_incomplete: { status: 502, message: () => "Gemini's answer was cut short before it was finished. Try again." },
};

function newRequestId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface Cors {
  headers: Record<string, string>;
  /** False when a list of allowed websites is set and this request comes from a page that is not on it. */
  allowed: boolean;
}

/** An origin as a browser writes it: no path and no trailing slash. A list entry typed with one still matches. */
const asOrigin = (value: string): string => value.trim().replace(/\/+$/, "").toLowerCase();

/**
 * Every answer may be read by the page that asked, a refusal included, so the app can say why it
 * was refused instead of reporting a failed connection. Which websites may use the reader is
 * decided on the request itself (see `allowed`), not by hiding the answer from the browser: these
 * headers only govern what a page may read, and no cookie is involved.
 */
function corsFor(req: Request, allowedOrigins: readonly string[]): Cors {
  const origin = req.headers.get("origin");
  const asked = req.headers.get("access-control-request-headers");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // Whatever headers the Supabase client sends are allowed. They carry no authority of their own.
    "Access-Control-Allow-Headers": asked && /^[A-Za-z0-9\-_, ]{1,400}$/.test(asked) ? asked : DEFAULT_ALLOWED_HEADERS,
    "Access-Control-Max-Age": "86400",
  };
  // No Origin header means the caller is not a browser page. It still has to sign in like anyone else.
  const allowed = allowedOrigins.length === 0 || origin === null || allowedOrigins.some((o) => asOrigin(o) === asOrigin(origin));
  return { headers, allowed };
}

/** The project's publishable key, which the Auth server asks for alongside the user's token. */
function publishableKey(env: EnvReader, req: Request): string {
  const raw = env("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    try {
      const keys: unknown = JSON.parse(raw);
      if (typeof keys === "object" && keys !== null) {
        const map = keys as Record<string, unknown>;
        const key = typeof map.default === "string" ? map.default : Object.values(map).find((v) => typeof v === "string");
        if (typeof key === "string" && key) return key;
      }
    } catch {
      // Not JSON: fall through to the other sources.
    }
  }
  // The legacy name, and last the key the caller sent. It is public either way, and the Auth server checks it.
  return env("SUPABASE_ANON_KEY") || req.headers.get("apikey") || "";
}

/**
 * Makes sure the caller is a signed-in user of this project by asking the project's Auth server
 * who the bearer token belongs to. That checks the session itself, not just the token's
 * signature, and it needs no service-role key. A publishable or secret key sent in place of a
 * user token is not a session and is turned away here.
 */
async function requireUser(req: Request, deps: HandlerDeps): Promise<string> {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token || token.length > MAX_TOKEN_LENGTH) throw new RequestError(401, "unauthorized", "Sign in to use the AI reader.");

  const supabaseUrl = deps.env("SUPABASE_URL")?.replace(/\/+$/, "");
  if (!supabaseUrl) throw new RequestError(503, "auth_unavailable", "The server cannot check who is signed in right now. Try again shortly.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TIMEOUT_MS);
  let res: Response;
  let user: unknown = null;
  try {
    res = await deps.fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, apikey: publishableKey(deps.env, req) },
      signal: controller.signal,
    });
    if (res.ok) user = await res.json().catch(() => null);
    else await res.body?.cancel().catch(() => undefined);
  } catch {
    throw new RequestError(503, "auth_unavailable", "The server cannot check who is signed in right now. Try again shortly.");
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 500) throw new RequestError(503, "auth_unavailable", "The server cannot check who is signed in right now. Try again shortly.");
  if (!res.ok || typeof user !== "object" || user === null) {
    throw new RequestError(401, "unauthorized", "Your sign-in is no longer valid. Sign in again to use the AI reader.");
  }
  const { id, aud, is_anonymous: anonymous } = user as Record<string, unknown>;
  if (typeof id !== "string" || !UUID.test(id) || (aud !== undefined && aud !== "authenticated") || anonymous === true) {
    throw new RequestError(401, "unauthorized", "Your sign-in is no longer valid. Sign in again to use the AI reader.");
  }

  const allowedUsers = listFromEnv(deps.env, "AI_ALLOWED_USER_IDS").map((u) => u.toLowerCase());
  if (allowedUsers.length > 0 && !allowedUsers.includes(id.toLowerCase())) {
    throw new RequestError(403, "forbidden", "Your account is not allowed to use the AI reader on this project.");
  }
  return id;
}

/** Reads the body as text, giving up as soon as it is larger than allowed. */
async function readBody(req: Request, maxBytes: number): Promise<string> {
  const tooLarge = (): RequestError => new RequestError(413, "too_large", `The request is larger than the ${maxBytes} bytes allowed.`);
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = deps.log ?? (() => undefined);

  return async function handle(req: Request): Promise<Response> {
    const started = now();
    const requestId = newRequestId();
    const cors = corsFor(req, listFromEnv(deps.env, "AI_ALLOWED_ORIGINS"));
    const baseHeaders: Record<string, string> = { ...cors.headers, "X-Request-Id": requestId, "Cache-Control": "no-store" };
    const facts: LogEntry = { event: "ai_request", requestId, method: req.method };

    const send = (status: number, body: unknown, extra: Record<string, string> = {}): Response => {
      log({ ...facts, status, ms: now() - started });
      return new Response(JSON.stringify(body), {
        status,
        headers: { ...baseHeaders, ...extra, "Content-Type": "application/json; charset=utf-8" },
      });
    };
    const fail = (status: number, code: string, message: string, retryable: boolean, retryAfterSeconds?: number): Response => {
      facts.code = code;
      const body: AiErrorBody = {
        error: { code, message, retryable, requestId, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) },
      };
      return send(status, body, retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : {});
    };

    try {
      if (req.method === "OPTIONS") {
        log({ ...facts, status: 204, ms: now() - started });
        return new Response(null, { status: 204, headers: baseHeaders });
      }
      if (req.method !== "POST") {
        facts.code = "method_not_allowed";
        return send(405, { error: { code: "method_not_allowed", message: "Use POST.", retryable: false, requestId } }, { Allow: "POST, OPTIONS" });
      }
      if (!cors.allowed) return fail(403, "origin_not_allowed", "This website is not allowed to use the AI reader on this project.", false);

      const userId = await requireUser(req, deps);
      facts.userId = userId;

      if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) {
        return fail(415, "unsupported_media_type", "Send the request as JSON.", false);
      }
      const limits = limitsFromEnv(deps.env);
      const raw = await readBody(req, limits.maxBodyBytes);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return fail(400, "invalid_request", "The request body is not valid JSON.", false);
      }
      const request = validateRequest(parsed, limits);
      facts.task = request.task;

      // The key is looked up only now, for a signed-in user with a well-formed request, and it goes nowhere but Google.
      const apiKey = deps.geminiApiKey()?.trim();
      const settings = geminiSettingsFromEnv(deps.env);
      facts.model = settings.model;
      if (!isUsableKey(apiKey)) {
        return fail(503, "not_configured", "The AI reader is not configured on the server: the GEMINI_API_KEY secret of the Edge Function has not been set.", false);
      }

      const logUpstreamText = /^(1|true|yes)$/i.test(deps.env("AI_LOG_UPSTREAM_ERRORS") ?? "");
      const onAttempt = (info: AttemptInfo): void => {
        log({
          event: "ai_gemini_attempt",
          requestId,
          attempt: info.attempt,
          ms: info.ms,
          outcome: info.outcome,
          httpStatus: info.httpStatus,
          upstreamStatus: info.upstreamStatus,
          schema: info.schema,
          // Google's error text can help find a setup problem, but it may repeat part of a request. Off unless asked for.
          ...(logUpstreamText && info.upstreamMessage ? { upstreamMessage: info.upstreamMessage.split(apiKey).join("[key]").slice(0, 300) } : {}),
        });
      };
      const common = { apiKey, fetch: deps.fetch, now, sleep, onAttempt };

      if (request.task === "status") {
        // A real, tiny call: it proves the key works and the model exists, which a look at the environment cannot.
        await callGemini({
          ...common,
          settings: { ...settings, maxRetries: Math.min(settings.maxRetries, 1) },
          input: "Reply with the single word: ready",
          interpret: (text) => text.length,
          deadlineAt: started + Math.min(settings.deadlineMs, 45_000),
        });
        const body: StatusResponseBody = { ok: true, model: settings.model };
        return send(200, body);
      }

      const { pages, documentPages } = request;
      facts.pages = pages.length;
      facts.chars = pages.reduce((n, p) => n + p.text.length, 0);
      const boundary = newBoundary();
      const result = await callGemini({
        ...common,
        settings,
        system: buildSystemInstruction(boundary, limits),
        input: buildInput(pages, boundary, documentPages),
        schemas: { strict: buildResponseSchema({ enums: true }), plain: buildResponseSchema({ enums: false }) },
        interpret: (text) => interpretModelOutput(parseModelJson(text), pages, limits),
        deadlineAt: started + settings.deadlineMs,
      });

      const { terms, risks, stats } = result.value;
      Object.assign(facts, {
        attempts: result.attempts,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        termsProposed: stats.termsProposed,
        termsAccepted: stats.termsAccepted,
        risksProposed: stats.risksProposed,
        risksAccepted: stats.risksAccepted,
        pagesCorrected: stats.pagesCorrected,
      });
      const body: ExtractResponseBody = { model: settings.model, terms, risks, stats };
      return send(200, body);
    } catch (err) {
      if (err instanceof RequestError) return fail(err.status, err.code, err.message, err.status === 503);
      if (err instanceof UpstreamError) {
        const { status, message } = UPSTREAM[err.code];
        facts.upstreamHttp = err.httpStatus;
        return fail(status, err.code, message(geminiSettingsFromEnv(deps.env)), err.retryable || err.code === "model_output_incomplete", err.retryAfterSeconds ?? undefined);
      }
      // Anything else is a bug here. Its message could hold request data, so only its kind is logged.
      facts.errorKind = err instanceof Error ? err.name : typeof err;
      return fail(500, "internal_error", "The AI reader ran into a problem. Try again.", true);
    }
  };
}
