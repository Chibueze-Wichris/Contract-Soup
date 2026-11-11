export interface PageText {
  page: number;
  text: string;
}

export type Confidence = "high" | "medium" | "low";
export type Severity = "high" | "medium" | "low";
export type FindingStatus = "open" | "confirmed" | "dismissed" | "legal_review";

export interface ContractTerm {
  id: string;
  /** Stable category id, e.g. "admin_fee". Display names live in categories.ts. */
  category: string;
  label: string;
  value: number | string | null;
  unit: string;
  pageRef: number;
  snippet: string;
  confidence: Confidence;
  confirmed: boolean;
  /** The exact phrase that triggered the match, so the UI can highlight it inside `snippet`. */
  match?: string;
}

export interface ClaimRow {
  claimId: string;
  /** ISO date, YYYY-MM-DD. The CSV step normalises dates before they reach the analyzer. */
  date: string;
  provider: string;
  category: string;
  billed: number;
  paid: number;
  feeType?: string;
  member?: string;
}

export interface Finding {
  id: string;
  severity: Severity;
  type: string;
  title: string;
  explanation: string;
  estimatedImpactUSD: number | null;
  /**
   * Contract evidence uses the real page number. Evidence that comes from the
   * claims file uses page 0 and lists claim IDs only, never member identifiers.
   */
  evidence: { page: number; snippet: string }[];
  calc?: string;
  status: FindingStatus;
  note?: string;
}

export interface Audit {
  id: string;
  name: string;
  createdAt: string;
  contractFileName: string;
  pageCount: number;
  claimsCount: number;
  terms: ContractTerm[];
  findings: Finding[];
  summary: {
    /** Sum of estimated impact for findings that are not dismissed. */
    exposureUSD: number;
    /** Number of non-dismissed findings per severity: high, medium, low. */
    bySeverity: Record<string, number>;
    /** Estimated exposure in USD per finding type. */
    byType: Record<string, number>;
  };
  analyzerVersion: string;
}

export interface Settings {
  /** Percent. Differences smaller than this are ignored. */
  feeTolerancePct: number;
  /** Number of standard deviations above the category mean that counts as an outlier. */
  outlierSigma: number;
}

export const DEFAULT_SETTINGS: Settings = { feeTolerancePct: 2, outlierSigma: 3 };

export interface Analyzer {
  version: string;
  extractTerms(pages: PageText[]): Promise<ContractTerm[]>;
  compare(terms: ContractTerm[], claims: ClaimRow[], settings: Settings): Promise<Finding[]>;
}
