/**
 * Stand-ins for the two services the Edge Function talks to: the project's Auth server and the
 * Gemini API. Nothing here reaches the network.
 */

import { createHandler, type LogEntry } from "../../supabase/functions/_shared/handler.ts";

export const TEST_KEY = "test-gemini-key-0123456789abcdef";
export const USER_ID = "3f1c2b9e-5d7a-4c1e-9a55-0b8f6d2e7a11";
export const USER_TOKEN = "user-session-token";
export const SUPABASE_URL = "https://project.supabase.test";

/** The JSON the Interactions API returns for a finished call whose answer is `text`. */
export function interaction(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "v1_test",
    object: "interaction",
    status: "completed",
    model: "gemini-3.8-flash",
    usage: { total_tokens: 1234, total_input_tokens: 1000, total_output_tokens: 234 },
    steps: [
      { type: "thought", signature: "abc" },
      { type: "model_output", content: [{ type: "text", text }] },
    ],
    ...extra,
  };
}

export const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export interface SeenRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export type GeminiReply = Response | ((seen: SeenRequest) => Response | Promise<Response>);

export interface World {
  handle: (req: Request) => Promise<Response>;
  /** Every outgoing request the handler made, in order. */
  seen: SeenRequest[];
  /** Outgoing requests to Gemini only. */
  gemini: SeenRequest[];
  logs: LogEntry[];
  /** Every pause the handler asked for, in milliseconds. Pauses do not really wait. */
  sleeps: number[];
  env: Record<string, string | undefined>;
  /** Moves the fake clock forward. */
  advance: (ms: number) => void;
}

export interface WorldOptions {
  env?: Record<string, string | undefined>;
  /** Replies from Gemini, used in order. The last one repeats. */
  gemini?: GeminiReply[];
  /** What the Auth server answers. Defaults to a signed-in user. */
  auth?: (seen: SeenRequest) => Response;
}

/** A handler wired to stand-ins, with a clock that only moves when told to. */
export function makeWorld(options: WorldOptions = {}): World {
  const env: Record<string, string | undefined> = {
    GEMINI_API_KEY: TEST_KEY,
    SUPABASE_URL,
    SUPABASE_ANON_KEY: "anon-key",
    ...options.env,
  };
  const seen: SeenRequest[] = [];
  const gemini: SeenRequest[] = [];
  const logs: LogEntry[] = [];
  const sleeps: number[] = [];
  const replies = [...(options.gemini ?? [])];
  let clock = 1_700_000_000_000;

  const auth =
    options.auth ??
    ((request: SeenRequest): Response =>
      request.headers.authorization === `Bearer ${USER_TOKEN}`
        ? jsonResponse(200, { id: USER_ID, aud: "authenticated", role: "authenticated", email: "someone@example.com" })
        : jsonResponse(401, { code: 401, msg: "invalid JWT" }));

  const fetchStub = async (input: string, init: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const request: SeenRequest = { url: input, method: init.method ?? "GET", headers, body: typeof init.body === "string" ? init.body : "" };
    seen.push(request);
    if (input.startsWith(`${SUPABASE_URL}/auth/v1/user`)) return auth(request);
    if (input.includes("/interactions")) {
      gemini.push(request);
      const reply = replies.length > 1 ? replies.shift() : replies[0];
      if (!reply) throw new Error("no Gemini reply was set up for this test");
      return typeof reply === "function" ? reply(request) : reply.clone();
    }
    throw new Error(`unexpected request to ${input}`);
  };

  const handle = createHandler({
    geminiApiKey: () => env.GEMINI_API_KEY,
    env: (name) => env[name],
    fetch: fetchStub,
    log: (entry) => logs.push(entry),
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });

  return { handle, seen, gemini, logs, sleeps, env, advance: (ms) => (clock += ms) };
}

export interface CallOptions {
  method?: string;
  token?: string | null;
  headers?: Record<string, string>;
  /** Sent as is when it is a string, otherwise as JSON. */
  body?: unknown;
}

/** A request to the function as the web app would send it. */
export function request({ method = "POST", token = USER_TOKEN, headers = {}, body }: CallOptions = {}): Request {
  const all: Record<string, string> = { "Content-Type": "application/json", apikey: "sb_publishable_test", Origin: "https://app.example.com", ...headers };
  if (token !== null) all.Authorization = `Bearer ${token}`;
  return new Request("https://project.supabase.test/functions/v1/extract-contract-terms", {
    method,
    headers: all,
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body ?? {}) } : {}),
  });
}

export async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}
