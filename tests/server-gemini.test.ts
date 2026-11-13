import assert from "node:assert/strict";
import { test } from "node:test";
import { UpstreamError, callGemini, readInteraction, type AttemptInfo, type GeminiCall } from "../supabase/functions/_shared/gemini.ts";
import { geminiSettingsFromEnv } from "../supabase/functions/_shared/limits.ts";
import { BadModelOutput, parseModelJson } from "../supabase/functions/_shared/validate.ts";
import { TEST_KEY, interaction, jsonResponse } from "./helpers/stubs.ts";

const SETTINGS = geminiSettingsFromEnv(() => undefined);

interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

type Reply = Response | Error | ((sent: Sent, signal: AbortSignal) => Promise<Response>);

function setup(replies: Reply[], overrides: Partial<GeminiCall<unknown>> = {}) {
  const sent: Sent[] = [];
  const sleeps: number[] = [];
  const attempts: AttemptInfo[] = [];
  let clock = 0;
  const queue = [...replies];
  const call: GeminiCall<unknown> = {
    apiKey: TEST_KEY,
    settings: SETTINGS,
    system: "SYSTEM",
    input: "INPUT",
    schemas: { strict: { type: "object", strict: true }, plain: { type: "object", strict: false } },
    interpret: (text) => parseModelJson(text),
    fetch: async (url, init) => {
      const entry: Sent = { url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as Record<string, unknown> };
      sent.push(entry);
      const reply = queue.length > 1 ? queue.shift() : queue[0];
      if (reply instanceof Error) throw reply;
      if (typeof reply === "function") return reply(entry, init.signal as AbortSignal);
      if (!reply) throw new Error("no reply set up");
      return reply.clone();
    },
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    deadlineAt: 140_000,
    onAttempt: (info) => attempts.push(info),
    ...overrides,
  };
  return { call, sent, sleeps, attempts, tick: (ms: number) => (clock += ms) };
}

const ok = (value: unknown = { fine: true }): Response => jsonResponse(200, interaction(JSON.stringify(value)));
const googleError = (status: number, word: string, message = "Something went wrong."): Response =>
  jsonResponse(status, { error: { code: status, message, status: word } });

async function fails(run: Promise<unknown>, code: string): Promise<UpstreamError> {
  try {
    await run;
  } catch (err) {
    assert.ok(err instanceof UpstreamError, `expected UpstreamError, got ${String(err)}`);
    assert.equal(err.code, code);
    return err;
  }
  throw new assert.AssertionError({ message: `expected the call to fail with ${code}` });
}

test("the request is the documented Interactions call, with the key in a header and storage off", async () => {
  const { call, sent } = setup([ok()]);
  const result = await callGemini(call);
  assert.deepEqual(result.value, { fine: true });
  assert.deepEqual([result.attempts, result.inputTokens, result.outputTokens], [1, 1000, 234]);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(sent[0].headers.get("x-goog-api-key"), TEST_KEY);
  assert.equal(sent[0].headers.get("api-revision"), "2026-05-20");
  assert.equal(sent[0].url.includes(TEST_KEY), false, "the key is never put in the address");
  assert.deepEqual(sent[0].body, {
    model: "gemini-3.8-flash",
    input: "INPUT",
    store: false,
    system_instruction: "SYSTEM",
    response_format: { type: "text", mime_type: "application/json", schema: { type: "object", strict: true } },
  });
});

test("the model, the thinking level and the API address come from settings", async () => {
  const settings = geminiSettingsFromEnv(
    (name) => ({ GEMINI_MODEL: "gemini-4-argon", GEMINI_THINKING_LEVEL: "low", GEMINI_API_BASE_URL: "http://127.0.0.1:9/", GEMINI_API_VERSION: "v1", GEMINI_API_REVISION: "" })[name],
  );
  const { call, sent } = setup([ok()], { settings });
  await callGemini(call);
  assert.equal(sent[0].url, "http://127.0.0.1:9/v1/interactions");
  assert.equal(sent[0].body.model, "gemini-4-argon");
  assert.deepEqual(sent[0].body.generation_config, { thinking_level: "low" });
  assert.equal(sent[0].headers.has("api-revision"), false);
});

test("the key is only ever sent over https, or to a stand-in on this machine", () => {
  const baseUrl = (value: string): string => geminiSettingsFromEnv((name) => (name === "GEMINI_API_BASE_URL" ? value : undefined)).baseUrl;
  const google = "https://generativelanguage.googleapis.com";
  assert.equal(baseUrl("https://proxy.example.com/gemini/"), "https://proxy.example.com/gemini");
  assert.equal(baseUrl("http://localhost:8787"), "http://localhost:8787");
  assert.equal(baseUrl("http://127.0.0.1:9/"), "http://127.0.0.1:9");
  assert.equal(baseUrl("http://host.docker.internal:8787"), "http://host.docker.internal:8787");
  // Plain http to anywhere else would put the key on the network in the clear. It is ignored.
  assert.equal(baseUrl("http://proxy.example.com"), google);
  assert.equal(baseUrl("http://127.0.0.1.example.com"), google);
  assert.equal(baseUrl("http://localhost.example.com:80/"), google);
  assert.equal(baseUrl("ftp://example.com"), google);
  assert.equal(baseUrl("not a url"), google);
});

test("readInteraction finds the answer text in the current and the older response shapes", () => {
  assert.equal(readInteraction(interaction("hello")).text, "hello");
  assert.equal(
    readInteraction({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }] }).text,
    "ab",
  );
  assert.equal(readInteraction({ outputs: [{ type: "thought" }, { type: "text", text: "legacy" }] }).text, "legacy");
  assert.equal(readInteraction({ output_text: "sugar" }).text, "sugar");
  assert.equal(readInteraction({ steps: [{ type: "thought", summary: [{ type: "text", text: "thinking" }] }] }).text, "", "thoughts are not the answer");
  for (const junk of [null, "x", [], { steps: "no" }]) assert.equal(readInteraction(junk).text, "");
});

test("a rate limit is retried, waiting as long as Google asks", async () => {
  const { call, sent, sleeps } = setup([googleError(429, "RESOURCE_EXHAUSTED"), jsonResponse(429, {}, { "Retry-After": "5" }), ok()]);
  const result = await callGemini(call);
  assert.equal(result.attempts, 3);
  assert.equal(sent.length, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 1_000 && sleeps[0] < 1_300, `first pause ${sleeps[0]}`);
  assert.equal(sleeps[1], 5_000);
});

test("retries are bounded", async () => {
  const { call, sent } = setup([googleError(503, "UNAVAILABLE")]);
  const err = await fails(callGemini(call), "upstream_unavailable");
  assert.equal(err.httpStatus, 503);
  assert.equal(sent.length, 3, "one call and two retries, then it stops");

  const none = setup([googleError(503, "UNAVAILABLE")], { settings: { ...SETTINGS, maxRetries: 0 } });
  await fails(callGemini(none.call), "upstream_unavailable");
  assert.equal(none.sent.length, 1);
});

test("a rate limit that outlasts the deadline is reported at once, with the wait", async () => {
  const { call, sent, sleeps } = setup([jsonResponse(429, {}, { "Retry-After": "600" })]);
  const err = await fails(callGemini(call), "rate_limited");
  assert.equal(err.retryAfterSeconds, 600);
  assert.equal(sent.length, 1);
  assert.deepEqual(sleeps, []);
});

test("failures that will not pass are not retried", async () => {
  const cases: [Response, string][] = [
    [googleError(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."), "key_rejected"],
    [googleError(403, "PERMISSION_DENIED"), "key_rejected"],
    [googleError(401, "UNAUTHENTICATED"), "key_rejected"],
    [googleError(404, "NOT_FOUND"), "model_unavailable"],
    [googleError(400, "FAILED_PRECONDITION", "User location is not supported for the API use."), "precondition_failed"],
  ];
  for (const [reply, code] of cases) {
    const { call, sent, sleeps } = setup([reply]);
    await fails(callGemini(call), code);
    assert.equal(sent.length, 1, code);
    assert.deepEqual(sleeps, [], code);
  }
});

test("when the API refuses the strict schema, the plain one is tried once", async () => {
  const worked = setup([googleError(400, "INVALID_ARGUMENT", "The schema is too complex."), ok()]);
  await callGemini(worked.call);
  assert.equal(worked.sent.length, 2);
  assert.deepEqual((worked.sent[0].body.response_format as { schema: unknown }).schema, { type: "object", strict: true });
  assert.deepEqual((worked.sent[1].body.response_format as { schema: unknown }).schema, { type: "object", strict: false });
  assert.deepEqual(worked.attempts.map((a) => a.schema), ["strict", "plain"]);
  assert.deepEqual(worked.sleeps, [], "this is not a retry, so there is no pause");

  const refused = setup([googleError(400, "INVALID_ARGUMENT")]);
  await fails(callGemini(refused.call), "upstream_rejected");
  assert.equal(refused.sent.length, 2, "strict, then plain, then it stops");
});

test("a call that takes too long is cut off and retried", async () => {
  const hang = (_: Sent, signal: AbortSignal): Promise<Response> =>
    new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  const { call, sent } = setup([hang, ok()], { settings: { ...SETTINGS, timeoutMs: 30 } });
  const result = await callGemini(call);
  assert.equal(result.attempts, 2);
  assert.equal(sent.length, 2);

  const always = setup([hang], { settings: { ...SETTINGS, timeoutMs: 20, maxRetries: 1 } });
  await fails(callGemini(always.call), "upstream_timeout");
  assert.equal(always.sent.length, 2);
});

test("a network failure is retried and then reported without its message", async () => {
  const secret = new TypeError(`fetch failed for key ${TEST_KEY}`);
  const { call, sent } = setup([secret]);
  const err = await fails(callGemini(call), "upstream_unavailable");
  assert.equal(sent.length, 3);
  assert.equal(JSON.stringify({ message: err.message, upstream: err.upstreamMessage }).includes(TEST_KEY), false);
});

test("no call is started once the deadline is too close", async () => {
  const late = setup([ok()], { deadlineAt: 2_000 });
  await fails(callGemini(late.call), "upstream_timeout");
  assert.equal(late.sent.length, 0);

  // The first failure leaves too little time for a pause and another call.
  const tight = setup([googleError(503, "UNAVAILABLE")], { deadlineAt: 5_000 });
  await fails(callGemini(tight.call), "upstream_unavailable");
  assert.equal(tight.sent.length, 1);
});

test("an answer that cannot be used is retried, then reported", async () => {
  const text = (body: string): Response => jsonResponse(200, interaction(body));
  const recovered = setup([text("Sure! Here are the terms."), jsonResponse(200, "<html>bad gateway</html>"), ok({ second: true })]);
  assert.deepEqual((await callGemini(recovered.call)).value, { second: true });
  assert.equal(recovered.sent.length, 3);

  const interpretFails = setup([ok()], {
    interpret: () => {
      throw new BadModelOutput("wrong shape");
    },
  });
  await fails(callGemini(interpretFails.call), "bad_model_output");
  assert.equal(interpretFails.sent.length, 3);

  for (const reply of [jsonResponse(200, interaction("")), jsonResponse(200, interaction("{}", { status: "failed" })), jsonResponse(200, { status: "completed", steps: [] })]) {
    await fails(callGemini(setup([reply]).call), "bad_model_output");
  }
});

test("an answer that was cut short is reported as such and not retried", async () => {
  const { call, sent } = setup([jsonResponse(200, interaction('{"provisions":[{"ref"', { status: "incomplete" }))]);
  await fails(callGemini(call), "model_output_incomplete");
  assert.equal(sent.length, 1);
});

test("a bug in interpreting the answer is not mistaken for a Gemini failure", async () => {
  const { call } = setup([ok()], {
    interpret: () => {
      throw new RangeError("a real bug");
    },
  });
  await assert.rejects(callGemini(call), RangeError);
});

test("each attempt is reported with codes and timings only", async () => {
  const { call, attempts } = setup([googleError(503, "UNAVAILABLE", "backend overloaded"), ok()]);
  await callGemini(call);
  assert.deepEqual(
    attempts.map((a) => [a.attempt, a.outcome, a.httpStatus, a.upstreamStatus]),
    [
      [1, "upstream_unavailable", 503, "UNAVAILABLE"],
      [2, "ok", 200, null],
    ],
  );
  assert.equal(attempts[0].upstreamMessage, "backend overloaded");
});
