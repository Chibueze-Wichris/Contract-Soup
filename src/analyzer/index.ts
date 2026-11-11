import { LocalHeuristicAnalyzer } from "./local";
import { RemoteAnalyzer } from "./remote";
import type { Analyzer } from "./types";

export type { Analyzer, Audit, ClaimRow, ContractTerm, Finding, PageText, Settings } from "./types";
export { DEFAULT_SETTINGS } from "./types";

let cached: Analyzer | null = null;

/** The only way the UI gets an analyzer. Defaults to the local, in-browser one. */
export function getAnalyzer(): Analyzer {
  if (cached) return cached;
  const mode = import.meta.env?.VITE_ANALYZER_MODE;
  const url = import.meta.env?.VITE_ANALYZER_URL;
  cached = mode === "remote" && url ? new RemoteAnalyzer(url) : new LocalHeuristicAnalyzer();
  return cached;
}
