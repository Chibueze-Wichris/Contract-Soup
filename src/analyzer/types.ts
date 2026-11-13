export interface PageText {
  page: number;
  text: string;
}

export type Confidence = "high" | "medium" | "low";
export type Severity = "high" | "medium" | "low";
export type FindingStatus = "open" | "confirmed" | "dismissed" | "legal_review";

/** How long before something happens notice must be given, as the contract states it. */
export interface NoticePeriod {
  value: number;
  unit: "days" | "months" | "years";
}

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

  // ---- Set by the AI reader. All optional, so terms from the built-in reader and older saved audits are unchanged. ----

  /** "ai" when Gemini read the term. Absent for terms found by the built-in rules or typed in by hand. */
  origin?: "ai";
  /** What the clause means, in plain words. */
  summary?: string;
  /** What has to be true for the term to apply. */
  conditions?: string[];
  /** Carve-outs: when the term does not apply. */
  exceptions?: string[];
  /** The date the term starts to apply, as YYYY-MM-DD, when the contract states one. */
  effectiveDate?: string;
  /** The date the term stops applying, as YYYY-MM-DD, when the contract states one. */
  expirationDate?: string;
  noticePeriod?: NoticePeriod;
  /** Other sections the clause points to, as the contract names them ("Section 9.2", "Exhibit B"). */
  relatedClauses?: string[];
  /** Ids of other terms in the same audit that this one depends on, limits or is limited by. */
  relatedTermIds?: string[];
  /** True when the reader was unsure, or an automatic check on the quoted wording failed. */
  needsReview?: boolean;
  /** Why it needs review, one reason per entry. */
  reviewReasons?: string[];
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

  // ---- Set on findings that come from the AI reader. Findings from the money checks have none of these. ----

  /**
   * "ai" marks an observation Gemini made about the contract wording. It never carries a dollar
   * figure: `estimatedImpactUSD` is null and it adds nothing to the exposure total.
   */
  origin?: "ai";
  /** How sure the AI reader was. */
  confidence?: Confidence;
  /** True when the AI reader was unsure and a person should decide. */
  needsReview?: boolean;
  /** Ids of the contract terms the observation is about. */
  relatedTermIds?: string[];
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
