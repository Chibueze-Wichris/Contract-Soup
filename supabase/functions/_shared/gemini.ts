/**
 * The one place that talks to Google. It calls the Gemini Interactions API over HTTPS with
 * `fetch`, so the function has no SDK to install and nothing here is specific to Deno.
 *
 *   POST {base}/{version}/interactions
 *   x-goog-api-key: <key>            the key goes in a header, never in the address
 *   { model, input, system_instruction, response_format: { type: "text",
 *     mime_type: "application/json", schema }, store: false }
 *
 * Every call has a time limit. Failures that may pass (rate limits, outages, time-outs, an
 * unusable answer) are tried again a bounded number of times, inside one overall deadline.
 * Errors are reported by a short code. Google's own error text is never passed on, and neither
 * the key nor any contract text is put in an error or a log entry.
 */

import type { GeminiSettings } from "./limits.ts";
import { BadModelOutput } from "./validate.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type UpstreamCode =
  | "key_rejected"
  | "model_unavailable"
  | "precondition_failed"
  | "rate_limited"
  | "upstream_unavailable"
  | "upstream_timeout"
  | "upstream_rejected"
  | "bad_model_output"
  | "model_output_incomplete";

const RETRYABLE: ReadonlySet<UpstreamCode> = new Set(["rate_limited", "upstream_unavailable", "upstream_timeout", "bad_model_output"]);

export class UpstreamError extends Error {
  constructor(
    readonly code: UpstreamCode,
    /** The HTTP status Google answered with, when it answered. */
    readonly httpStatus: number | null = null,
    readonly retryAfterSeconds: number | null = null,
    /** Google's status word, such as "RESOURCE_EXHAUSTED". Safe to log. */
    readonly upstreamStatus: string | null = null,
    /** Google's own message. Only ever logged, and only when the owner asks for it. */
    readonly upstreamMessage: string | null = null,
  ) {
    super(code);
    this.name = "UpstreamError";
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

export interface AttemptInfo {
  attempt: number;
  ms: number;
  /** "ok", or the error code. */
  outcome: string;
  httpStatus: number | null;
  upstreamStatus: string | null;
  upstreamMessage: string | null;
  schema: "strict" | "plain" | "none";
}

export interface GeminiCall<T> {
  apiKey: string;
  settings: GeminiSettings;
  system?: string;
  input: string;
  /** The response schema in its strict and plain forms. Leave out for a free-text answer. */
  schemas?: { strict: unknown; plain: unknown };
  /** Turns the model's text into a result. Throwing BadModelOutput makes the call count as failed and worth retrying. */
  interpret: (text: string) => T;
  fetch: FetchLike;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** The time, in epoch milliseconds, by which the whole call must be over. */
  deadlineAt: number;
  onAttempt?: (info: AttemptInfo) => void;
}

export interface GeminiResult<T> {
  value: T;
  attempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** Shorter than this and a call is not worth starting. */
const MIN_ATTEMPT_MS = 3_000;
/** Kept back from the deadline so the function can still send its answer. */
const SAFETY_MS = 1_500;
const MAX_BACKOFF_MS = 8_000;
const MAX_ERROR_BODY = 20_000;

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);

export interface InteractionReading {
  status: string | null;
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Pulls the answer text out of an Interaction resource. The current format lists `steps`, where
 * the answer is the text content of the `model_output` steps. Two older shapes are read too.
 */
export function readInteraction(json: unknown): InteractionReading {
  const out: InteractionReading = { status: null, text: "", inputTokens: null, outputTokens: null };
  if (!isObject(json)) return out;
  if (typeof json.status === "string") out.status = json.status;

  const parts: string[] = [];
  const takeText = (content: unknown): void => {
    if (!Array.isArray(content)) return;
    for (const c of content) if (isObject(c) && c.type === "text" && typeof c.text === "string") parts.push(c.text);
  };
  if (Array.isArray(json.steps)) {
    for (const step of json.steps) if (isObject(step) && step.type === "model_output") takeText(step.content);
  }
  if (parts.length === 0) takeText(json.outputs);
  if (parts.length === 0 && typeof json.output_text === "string") parts.push(json.output_text);
  out.text = parts.join("");

  if (isObject(json.usage)) {
    const { total_input_tokens: input, total_output_tokens: output } = json.usage;
    if (typeof input === "number") out.inputTokens = input;
    if (typeof output === "number") out.outputTokens = output;
  }
  return out;
}

function retryAfterSeconds(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 3_600 ? Math.ceil(n) : null;
}

/** Sorts a failed HTTP answer from Google into one of our codes. */
function classifyFailure(res: Response, bodyText: string): UpstreamError {
  const upstreamStatus = /"status"\s*:\s*"([A-Z_]{3,40})"/.exec(bodyText)?.[1] ?? null;
  const upstreamMessage = /"message"\s*:\s*"((?:[^"\\]|\\.){0,600})/.exec(bodyText)?.[1] ?? null;
  const make = (code: UpstreamCode, retryAfter: number | null = null): UpstreamError =>
    new UpstreamError(code, res.status, retryAfter, upstreamStatus, upstreamMessage);

  const { status } = res;
  if (status === 429) return make("rate_limited", retryAfterSeconds(res));
  if (status === 401 || status === 403) return make("key_rejected");
  if (status === 404) return make("model_unavailable");
  if (status === 408 || status === 504) return make("upstream_timeout");
  if (status >= 500) return make("upstream_unavailable", retryAfterSeconds(res));
  if (status === 400) {
    if (/API_KEY_INVALID|API key not valid|API key expired|API_KEY_/i.test(bodyText)) return make("key_rejected");
    if (upstreamStatus === "FAILED_PRECONDITION") return make("precondition_failed");
    if (upstreamStatus === "NOT_FOUND") return make("model_unavailable");
  }
  return make("upstream_rejected");
}

interface Once<T> {
  ok: true;
  value: T;
  inputTokens: number | null;
  outputTokens: number | null;
}

async function callOnce<T>(call: GeminiCall<T>, schema: unknown, timeoutMs: number): Promise<Once<T>> {
  const { settings } = call;
  const body: Loose = { model: settings.model, input: call.input, store: false };
  if (call.system) body.system_instruction = call.system;
  if (schema !== undefined) body.response_format = { type: "text", mime_type: "application/json", schema };
  if (settings.thinkingLevel) body.generation_config = { thinking_level: settings.thinkingLevel };

  const headers: Record<string, string> = { "Content-Type": "application/json", "x-goog-api-key": call.apiKey };
  if (settings.apiRevision) headers["Api-Revision"] = settings.apiRevision;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    let text: string;
    try {
      res = await call.fetch(`${settings.baseUrl}/${settings.apiVersion}/interactions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // The time limit covers reading the answer as well as waiting for it to start.
      text = await res.text();
    } catch {
      throw new UpstreamError(controller.signal.aborted ? "upstream_timeout" : "upstream_unavailable");
    }
    if (!res.ok) throw classifyFailure(res, text.slice(0, MAX_ERROR_BODY));

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new UpstreamError("bad_model_output", res.status);
    }
    const reading = readInteraction(json);
    if (reading.status === "incomplete" || reading.status === "requires_continuation") {
      throw new UpstreamError("model_output_incomplete", res.status, null, reading.status);
    }
    if (reading.status !== null && reading.status !== "completed") {
      throw new UpstreamError("bad_model_output", res.status, null, reading.status);
    }
    if (!reading.text.trim()) throw new UpstreamError("bad_model_output", res.status, null, reading.status);
    try {
      return { ok: true, value: call.interpret(reading.text), inputTokens: reading.inputTokens, outputTokens: reading.outputTokens };
    } catch (err) {
      if (err instanceof BadModelOutput) throw new UpstreamError("bad_model_output", res.status, null, reading.status);
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls Gemini and returns the interpreted answer, or throws UpstreamError.
 * At most `1 + maxRetries` attempts are made, plus one more if the API refuses the strict schema
 * and the plain one has to be used instead.
 */
export async function callGemini<T>(call: GeminiCall<T>): Promise<GeminiResult<T>> {
  const { settings } = call;
  let schemaMode: AttemptInfo["schema"] = call.schemas ? "strict" : "none";
  let attempt = 0;
  let retries = 0;
  let last: UpstreamError | null = null;

  for (;;) {
    const remaining = call.deadlineAt - call.now() - SAFETY_MS;
    if (remaining < MIN_ATTEMPT_MS) throw last ?? new UpstreamError("upstream_timeout");
    attempt += 1;
    const started = call.now();
    const schema = schemaMode === "none" ? undefined : schemaMode === "strict" ? call.schemas?.strict : call.schemas?.plain;
    try {
      const done = await callOnce(call, schema, Math.min(settings.timeoutMs, remaining));
      call.onAttempt?.({ attempt, ms: call.now() - started, outcome: "ok", httpStatus: 200, upstreamStatus: null, upstreamMessage: null, schema: schemaMode });
      return { value: done.value, attempts: attempt, inputTokens: done.inputTokens, outputTokens: done.outputTokens };
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      last = err;
      call.onAttempt?.({
        attempt,
        ms: call.now() - started,
        outcome: err.code,
        httpStatus: err.httpStatus,
        upstreamStatus: err.upstreamStatus,
        upstreamMessage: err.upstreamMessage,
        schema: schemaMode,
      });

      // A schema the API will not compile is not a reason to give up: say the same thing in words instead.
      if (err.code === "upstream_rejected" && err.httpStatus === 400 && schemaMode === "strict") {
        schemaMode = "plain";
        continue;
      }
      if (!err.retryable || retries >= settings.maxRetries) throw err;
      retries += 1;
      const backoff = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** (retries - 1)) + Math.floor(Math.random() * 250);
      const wait = Math.max(backoff, (err.retryAfterSeconds ?? 0) * 1_000);
      if (call.now() + wait + MIN_ATTEMPT_MS + SAFETY_MS > call.deadlineAt) throw err;
      await call.sleep(wait);
    }
  }
}
