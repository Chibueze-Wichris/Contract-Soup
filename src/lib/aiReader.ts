import { NO_ANSWER_MESSAGE, type AiTransport, type AiTransportResult } from "@/analyzer";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { readErrorResponse, readStatusResponse, type AiRequestBody } from "../../supabase/functions/_shared/wire.ts";

/**
 * The browser's side of the AI reader: one HTTPS request to the project's own Edge Function.
 *
 * There is no Gemini key here and there must never be one. The request carries the signed-in
 * user's session token and the project's publishable key, which is public. The function holds
 * the Gemini key and is the only thing that talks to Google.
 */

/** The AI reader needs an account to call the function with, so it is only offered in builds that have sign-in. */
export const AI_READER_AVAILABLE = isSupabaseConfigured;

export const AI_FUNCTION_NAME = "extract-contract-terms";

/** A little longer than the 150 seconds after which Supabase gives up on a function, so its answer is the one seen. */
const REQUEST_TIMEOUT_MS = 165_000;

/**
 * After a request ended with no answer at all: does anything answer at the function's address?
 *
 * A browser hides an answer that lacks the cross-origin headers, and Supabase's answer for a
 * function that does not exist has none. To the request below, "not deployed" therefore looks the
 * same as "no connection". This asks once more in the one way that needs no such headers. The
 * reply cannot be read, only whether one came. It carries no session, no key and no contract text.
 */
async function somethingAnswers(url: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8_000);
  try {
    await fetch(url, { method: "GET", mode: "no-cors", cache: "no-store", credentials: "omit", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

async function post(body: AiRequestBody, signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): Promise<AiTransportResult> {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, "");
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!supabase || !base || !publishableKey) return { status: 0, body: null, failure: "signed_out" };

  // getSession() renews the token first when it has run out.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: 0, body: null, failure: "signed_out" };

  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cancel = (): void => controller.abort();
  signal?.addEventListener("abort", cancel);
  const url = `${base}/functions/v1/${AI_FUNCTION_NAME}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: publishableKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json: unknown = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } catch (err) {
    if (signal?.aborted) throw err; // cancelled by the user: the caller knows
    if (timedOut) return { status: 0, body: null, failure: "timeout" };
    return { status: 0, body: null, failure: (await somethingAnswers(url)) ? "no_answer" : "offline" };
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

/** Sends page text to the AI reader. This is the only function in the app that sends contract text anywhere. */
export const aiTransport: AiTransport = (body, signal) => post(body, signal);

export type AiReaderCheck = { ok: true; model: string } | { ok: false; message: string };

/**
 * Asks the function whether it can reach Gemini with the key and the model it has been given.
 * Sends no contract text. Used by the check in Settings.
 */
export async function checkAiReader(): Promise<AiReaderCheck> {
  let result: AiTransportResult;
  try {
    result = await post({ task: "status" }, undefined, 60_000);
  } catch {
    return { ok: false, message: "The AI reader could not be reached. Check your connection and try again." };
  }
  if (result.status === 200) {
    const status = readStatusResponse(result.body);
    if (status) return { ok: true, model: status.model };
    return { ok: false, message: "The AI reader answered, but not in a form this version of the app understands." };
  }
  if (result.status === 0) {
    if (result.failure === "signed_out") return { ok: false, message: "You are signed out. Sign in again, then check the AI reader." };
    if (result.failure === "timeout") return { ok: false, message: "The AI reader took too long to answer. Try again." };
    if (result.failure === "no_answer") return { ok: false, message: NO_ANSWER_MESSAGE };
    return { ok: false, message: "The AI reader could not be reached. Check your connection and try again." };
  }
  const own = readErrorResponse(result.body);
  if (own) return { ok: false, message: own.message };
  if (result.status === 404) {
    return {
      ok: false,
      message: "The extract-contract-terms function was not found on this Supabase project. Deploy it, then check again.",
    };
  }
  if (result.status === 401 || result.status === 403) {
    return { ok: false, message: "Your sign-in was not accepted by the function. Sign out, sign in again, then check again." };
  }
  return { ok: false, message: `The AI reader is not working right now (the server answered with status ${result.status}).` };
}
