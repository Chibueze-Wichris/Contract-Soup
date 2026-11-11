import { runChecks } from "./checks";
import { extractTermsFromPages } from "./extract";
import type { Analyzer, ClaimRow, ContractTerm, Finding, PageText, Settings } from "./types";

export const LOCAL_ANALYZER_VERSION = "local-heuristic-1.0.0";

/**
 * Rule-based analyzer that runs entirely in the browser.
 * extractTerms: keyword + regex rules (see rules.ts).
 * compare: pure, deterministic TypeScript (see checks.ts). No LLM, no randomness.
 */
export class LocalHeuristicAnalyzer implements Analyzer {
  readonly version = LOCAL_ANALYZER_VERSION;

  async extractTerms(pages: PageText[]): Promise<ContractTerm[]> {
    return extractTermsFromPages(pages);
  }

  async compare(terms: ContractTerm[], claims: ClaimRow[], settings: Settings): Promise<Finding[]> {
    return runChecks(terms, claims, settings);
  }
}
