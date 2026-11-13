/**
 * Supabase Edge Function: extract-contract-terms
 *
 * Reads contract page text with Google Gemini for a signed-in ContractSoup user and returns
 * contract terms and risk observations, each tied to wording that has been checked against the
 * page it is quoted from.
 *
 * - The Gemini API key lives only in this function's environment. Locally that is
 *   supabase/functions/.env (never committed). In production it is a Supabase secret:
 *   `supabase secrets set GEMINI_API_KEY=...`. The browser never receives it.
 * - JWT verification stays on for this function (see supabase/config.toml), and the handler
 *   checks the caller's session with the project's Auth server as well.
 * - It accepts page text only. It never receives files, claims rows or member data.
 *
 * All the logic is in ../_shared, written without Deno APIs so it can be tested under Node.
 * This file only connects it to the Edge runtime.
 */

import { createHandler } from "../_shared/handler.ts";

const handler = createHandler({
  // Read on each request, so a secret that has just been set is picked up without a redeploy.
  geminiApiKey: () => Deno.env.get("GEMINI_API_KEY"),
  env: (name) => Deno.env.get(name),
  fetch: (input, init) => fetch(input, init),
  // One line of JSON per event: counts, timings and short codes. Never contract text, never the key.
  log: (entry) => console.log(JSON.stringify(entry)),
});

Deno.serve(handler);
