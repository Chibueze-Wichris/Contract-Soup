import type { Analyzer, ClaimRow, ContractTerm, Finding, PageText, Settings } from "./types";

/**
 * Placeholder for a future server-side analyzer (for example an LLM-assisted
 * extractor). Nothing in the app uses it yet; getAnalyzer() only returns it
 * when VITE_ANALYZER_MODE=remote.
 *
 * PRIVACY: today every file is processed in the browser and never uploaded.
 * Before wiring this up, require explicit per-audit consent, send the minimum
 * (contract page text only), and never send claim rows or member identifiers.
 * Run compare() locally even when extraction is remote, so the math stays
 * deterministic and auditable.
 */
export class RemoteAnalyzer implements Analyzer {
  readonly version = "remote-stub-0.0.0";

  constructor(private readonly baseUrl: string) {}

  async extractTerms(_pages: PageText[]): Promise<ContractTerm[]> {
    // FUTURE: POST `${this.baseUrl}/extract-terms` with { pages } and an auth header
    // (supabase.auth.getSession() -> access_token). Validate the JSON response
    // against ContractTerm[] before returning, and set confirmed: false on every term.
    throw new Error(`The remote analyzer at ${this.baseUrl} is not available yet.`);
  }

  async compare(_terms: ContractTerm[], _claims: ClaimRow[], _settings: Settings): Promise<Finding[]> {
    // FUTURE: keep this local (LocalHeuristicAnalyzer.compare) so claims never leave the device.
    // If a server comparison is ever added, send aggregates and claim IDs only.
    throw new Error(`The remote analyzer at ${this.baseUrl} is not available yet.`);
  }
}
