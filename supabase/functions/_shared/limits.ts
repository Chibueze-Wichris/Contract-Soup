/**
 * Size limits and server settings for the AI reader. Every value has a safe default and can be
 * changed with an environment variable, so nothing here needs a code change. Shared with the
 * web app, which only uses the defaults to size its requests.
 */

export type EnvReader = (name: string) => string | undefined;

export interface Limits {
  /** Largest request body accepted, in bytes. */
  maxBodyBytes: number;
  /** Most pages in one request. */
  maxPages: number;
  /** Most characters of text on one page. */
  maxPageChars: number;
  /** Most characters of page text in one request. */
  maxTotalChars: number;
  /** Highest page number accepted. */
  maxPageNumber: number;
  /** Most provisions kept from one model answer. */
  maxTerms: number;
  /** Most observations kept from one model answer. */
  maxRisks: number;
  /** A quotation shorter than this proves too little to count as evidence. */
  minQuoteChars: number;
  /** A quotation longer than this is rejected. */
  maxQuoteChars: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxBodyBytes: 1_000_000,
  maxPages: 60,
  maxPageChars: 30_000,
  maxTotalChars: 200_000,
  maxPageNumber: 100_000,
  maxTerms: 80,
  maxRisks: 25,
  minQuoteChars: 15,
  maxQuoteChars: 1_200,
};

/** What the web app puts in one request. Kept well inside the server defaults above. */
export const CLIENT_BATCH = { maxPages: 25, maxChars: 80_000 } as const;

export const DEFAULT_MODEL = "gemini-3.8-flash";
export const DEFAULT_API_BASE_URL = "https://generativelanguage.googleapis.com";
export const DEFAULT_API_VERSION = "v1beta";
/** The revision of the Interactions API this code was written against (the `steps` response format). */
export const DEFAULT_API_REVISION = "2026-05-20";

export interface GeminiSettings {
  model: string;
  baseUrl: string;
  apiVersion: string;
  /** Sent as the Api-Revision header. Empty means the header is left out. */
  apiRevision: string;
  /** Sent as generation_config.thinking_level. Empty means the model's own default. */
  thinkingLevel: string;
  /** Longest one call to Gemini may take, in milliseconds. */
  timeoutMs: number;
  /** How many times a failed call is tried again. */
  maxRetries: number;
  /** Longest the whole request may take, in milliseconds. Edge Functions are cut off at 150 seconds. */
  deadlineMs: number;
}

function intFromEnv(env: EnvReader, name: string, fallback: number, min: number, max: number): number {
  const raw = env(name)?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

function textFromEnv(env: EnvReader, name: string, fallback: string, pattern: RegExp): string {
  const raw = env(name)?.trim();
  return raw && pattern.test(raw) ? raw : fallback;
}

export function limitsFromEnv(env: EnvReader): Limits {
  const d = DEFAULT_LIMITS;
  const maxTotalChars = intFromEnv(env, "AI_MAX_TOTAL_CHARS", d.maxTotalChars, 1_000, 2_000_000);
  return {
    ...d,
    maxPages: intFromEnv(env, "AI_MAX_PAGES_PER_REQUEST", d.maxPages, 1, 1_000),
    maxPageChars: intFromEnv(env, "AI_MAX_CHARS_PER_PAGE", d.maxPageChars, 500, 500_000),
    maxTotalChars,
    // Room for the text as UTF-8 with JSON escaping, unless a size is set outright.
    maxBodyBytes: intFromEnv(env, "AI_MAX_BODY_BYTES", Math.max(d.maxBodyBytes, maxTotalChars * 4 + 64_000), 10_000, 20_000_000),
  };
}

export function geminiSettingsFromEnv(env: EnvReader): GeminiSettings {
  return {
    model: textFromEnv(env, "GEMINI_MODEL", DEFAULT_MODEL, /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
    baseUrl: textFromEnv(env, "GEMINI_API_BASE_URL", DEFAULT_API_BASE_URL, /^https?:\/\/[^\s]+$/).replace(/\/+$/, ""),
    apiVersion: textFromEnv(env, "GEMINI_API_VERSION", DEFAULT_API_VERSION, /^v[0-9][A-Za-z0-9]{0,15}$/),
    apiRevision: env("GEMINI_API_REVISION") === "" ? "" : textFromEnv(env, "GEMINI_API_REVISION", DEFAULT_API_REVISION, /^[0-9A-Za-z._-]{1,32}$/),
    thinkingLevel: textFromEnv(env, "GEMINI_THINKING_LEVEL", "", /^[a-z]{1,16}$/),
    timeoutMs: intFromEnv(env, "GEMINI_TIMEOUT_MS", 120_000, 1_000, 390_000),
    maxRetries: intFromEnv(env, "GEMINI_MAX_RETRIES", 2, 0, 5),
    deadlineMs: intFromEnv(env, "AI_REQUEST_DEADLINE_MS", 140_000, 5_000, 395_000),
  };
}

/** A key that is missing, blank, or still the placeholder from .env.example counts as not set. */
export function isUsableKey(key: string | undefined): key is string {
  const k = key?.trim() ?? "";
  if (k.length < 8) return false;
  return !/^(your[_-]|replace[_-]|changeme|placeholder|<)/i.test(k) && !/\s/.test(k);
}

/** Comma-separated list from the environment, trimmed, with empty entries dropped. */
export function listFromEnv(env: EnvReader, name: string): string[] {
  return (env(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
