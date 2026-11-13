import { GeminiAnalyzer, type AiTransport } from "./gemini";
import { LocalHeuristicAnalyzer } from "./local";
import type { Analyzer } from "./types";

export type { Analyzer, Audit, ClaimRow, ContractTerm, Finding, NoticePeriod, PageText, Settings } from "./types";
export { DEFAULT_SETTINGS } from "./types";
export { AiReaderError, GEMINI_ANALYZER_VERSION, GeminiAnalyzer } from "./gemini";
export type { AiProgress, AiReadOptions, AiReadReport, AiTransport, AiTransportResult } from "./gemini";

let cached: Analyzer | null = null;

/**
 * The built-in analyzer: rules for reading terms, arithmetic for checking claims. Everything it
 * does happens in the browser. This is what the app uses unless the user chooses the AI reader
 * for an audit.
 */
export function getAnalyzer(): Analyzer {
  cached ??= new LocalHeuristicAnalyzer();
  return cached;
}

/**
 * The hybrid analyzer for one audit: Gemini reads the contract through the Edge Function, and the
 * same local checks do the arithmetic. Make a new one for each contract, because it remembers
 * what Gemini said about the wording until the audit is run.
 *
 * Which analyzer an audit uses is the user's choice, made for that audit. There is no build
 * setting that switches it, and a failure of this one never falls back to the other by itself.
 */
export function createGeminiAnalyzer(transport: AiTransport): GeminiAnalyzer {
  return new GeminiAnalyzer(transport);
}
