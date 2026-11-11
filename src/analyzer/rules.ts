import type { TermCategoryId } from "./categories";
import type { AmountType } from "./amounts";

export interface ExtractionRule {
  category: TermCategoryId;
  /** Trigger phrase. The first match inside a sentence creates one term. */
  pattern: RegExp;
  /** Which kind of amount to look for first. */
  prefer: AmountType | "any";
  /**
   * Clause rules describe a yes/no provision. An amount is optional context,
   * only looked for inside the same sentence, and the value is "Clause present"
   * when none is found.
   */
  clause?: boolean;
  /**
   * Fee rules only accept the preferred amount type. If the sentence or its
   * neighbourhood holds amounts of another type (for example a 3% adjustment
   * next to the words "administrative fee") the match is dropped instead of
   * being reported with the wrong number.
   */
  strict?: boolean;
  /** Amount types that never make sense for this category (for example a payment deadline in days next to a rebate share). */
  exclude?: AmountType[];
}

export const EXTRACTION_RULES: ExtractionRule[] = [
  {
    category: "admin_fee",
    pattern: /\b(?:administrative|admin|plan administration|TPA)\s+(?:services?\s+)?fees?\b/i,
    prefer: "dollar",
    strict: true,
  },
  {
    category: "rebate_guarantee",
    pattern:
      /\b(?:rebate\s+guarantee|guaranteed\s+rebates?|guarantee[sd]?\b[^.;]{0,120}?\brebates?|rebates?\b[^.;]{0,100}?\b(?:guarantee[sd]?|pass[- ]?through|remit(?:ted)?|retain(?:s|ed)?))/i,
    prefer: "percent",
    exclude: ["days"],
  },
  {
    category: "spread_pricing",
    pattern: /\bspread\s+pricing\b|\bpricing\s+spread\b|\bretain(?:s|ed)?\s+(?:any\s+|the\s+)?(?:difference|margin)\b/i,
    prefer: "any",
    clause: true,
  },
  {
    category: "mac_pricing",
    pattern: /\bMAC\b|\bmaximum\s+allowable\s+cost\b/i,
    prefer: "any",
    clause: true,
  },
  {
    category: "dispensing_fee",
    pattern: /\bdispensing\s+fees?\b/i,
    prefer: "dollar",
    strict: true,
  },
  {
    category: "network_access_fee",
    pattern: /\bnetwork\s+(?:access\s+)?fees?\b|\baccess\s+fees?\b/i,
    prefer: "dollar",
    strict: true,
  },
  {
    category: "stop_loss",
    pattern: /\bstop[- ]loss\b|\battachment\s+point\b|\bspecific\s+deductible\b/i,
    prefer: "dollar",
  },
  {
    category: "minimum_premium",
    pattern: /\bminimum\s+premium\b/i,
    prefer: "any",
  },
  {
    category: "run_in_run_out",
    pattern: /\brun[- ]?(?:in|out)\b/i,
    prefer: "dollar",
    strict: true,
  },
  {
    category: "termination_fee",
    pattern:
      /\b(?:early\s+)?termination\s+(?:fee|charge|payment)s?\b|\bdisengagement\s+fees?\b|\btransition\s+fees?\b|\bdata\s+transition\b/i,
    prefer: "dollar",
    strict: true,
  },
  {
    category: "auto_renewal",
    pattern: /\bauto(?:matically)?[- ]?renew(?:s|al|ed)?\b|\bevergreen\b/i,
    prefer: "days",
    clause: true,
  },
  {
    category: "audit_rights",
    pattern:
      /\baudit\b[^.;]{0,160}?\b(?:limited|limit|once|not more than|no more than|shall not exceed|only|restrict\w*|sample)\b|\b(?:limit\w*|restrict\w*)\b[^.;]{0,100}?\baudit/i,
    prefer: "any",
    clause: true,
  },
  {
    category: "price_adjustment",
    pattern:
      /\bprice\s+adjustments?\b|\badjust(?:ed|ment|s)?\s+(?:the\s+)?(?:administrative\s+)?(?:fees?|pricing|rates?)\b|\bannual\s+(?:fee\s+)?(?:increase|escalat\w+)\b|\breserves?\s+the\s+right\s+to\s+(?:adjust|modify|increase|revise)\b/i,
    prefer: "percent",
    clause: true,
  },
  {
    category: "other_fees",
    pattern:
      /\b(?:any\s+|such\s+)?other\s+(?:fees|charges|costs)\b|\badditional\s+(?:fees|charges)\b|\bfees\s+not\s+(?:otherwise\s+)?(?:specified|listed|described)\b/i,
    prefer: "any",
    clause: true,
  },
];
