/**
 * Helpers for testing the web app's side of the AI reader. The analyzer is given a transport
 * that hands each request to the real Edge Function handler, which in turn talks to the
 * stand-ins in stubs.ts. Nothing reaches the network.
 */

import type { AiTransport, AiTransportResult } from "../../src/analyzer/gemini";
import type { PageText } from "../../src/analyzer/types";
import { SAMPLE_PAGES } from "../../src/data/sample";
import { sampleModelAnswerFor } from "./sampleAnswer";
import { interaction, jsonResponse, makeWorld, request, type World, type WorldOptions } from "./stubs";

export interface Wire {
  transport: AiTransport;
  world: World;
  /** Every request body the analyzer handed to the transport, exactly as it would be sent. */
  sent: string[];
  /** The page numbers of each request, in order. */
  sentPages: number[][];
}

export interface WireOptions extends Omit<WorldOptions, "gemini"> {
  /**
   * What Gemini answers for a request holding these pages. The default is the sample answer for
   * those pages. Return a Response to answer with something else, such as an error.
   */
  answer?: (pages: number[], call: number) => unknown | Response;
  /** Session token sent with each request. Null sends none. */
  token?: string | null;
}

/** Connects an analyzer to the real handler. */
export function makeWire(options: WireOptions = {}): Wire {
  const sent: string[] = [];
  const sentPages: number[][] = [];
  let current: number[] = [];
  let geminiCalls = 0;

  const world = makeWorld({
    ...options,
    gemini: [
      () => {
        geminiCalls += 1;
        const answer = options.answer ? options.answer(current, geminiCalls) : sampleModelAnswerFor(current);
        return answer instanceof Response ? answer : jsonResponse(200, interaction(JSON.stringify(answer)));
      },
    ],
  });

  const transport: AiTransport = async (body, signal): Promise<AiTransportResult> => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const text = JSON.stringify(body);
    sent.push(text);
    current = body.task === "extract" ? body.pages.map((p) => p.page) : [];
    sentPages.push(current);
    const res = await world.handle(request({ body: text, ...(options.token !== undefined ? { token: options.token } : {}) }));
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  return { transport, world, sent, sentPages };
}

/**
 * The sample agreement with every page padded out, so that it no longer fits in one request.
 * The contract wording is untouched; the padding is appended after it.
 */
export function longSample(charsPerPage = 18_000): PageText[] {
  return SAMPLE_PAGES.map((p) => {
    const filler = ` Schedule line ${p.page} is intentionally left without terms.`;
    let text = p.text;
    while (text.length < charsPerPage) text += filler;
    return { page: p.page, text };
  });
}

/** Whitespace-insensitive "is this wording on that page". */
export function isOnPage(pages: readonly PageText[], page: number, quote: string): boolean {
  const squash = (s: string): string => s.replace(/\s+/g, " ").trim();
  const text = pages.find((p) => p.page === page)?.text ?? "";
  return squash(text).includes(squash(quote));
}
