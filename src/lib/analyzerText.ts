import type { Audit } from "@/analyzer";

/**
 * Reads what made an audit from the analyzer version saved with it, such as
 * "local-heuristic-1.0.0" or "gemini-hybrid-1.0.0 (gemini-3.8-flash) + local-heuristic-1.0.0".
 * Kept free of imports with side effects, so the PDF builder and the tests can use it.
 */

/** True when Gemini read the contract for this audit. */
export function usedGemini(audit: Pick<Audit, "analyzerVersion">): boolean {
  return audit.analyzerVersion.startsWith("gemini-hybrid");
}

/** The Gemini model named in the version, or null when the audit did not use Gemini or names none. */
export function geminiModel(audit: Pick<Audit, "analyzerVersion">): string | null {
  if (!usedGemini(audit)) return null;
  return /\(([^()]{1,100})\)/.exec(audit.analyzerVersion)?.[1] ?? null;
}

/** "Google Gemini (gemini-3.8-flash)" or "Google Gemini". */
export function geminiName(audit: Pick<Audit, "analyzerVersion">): string {
  const model = geminiModel(audit);
  return model ? `Google Gemini (${model})` : "Google Gemini";
}
