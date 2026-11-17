/**
 * The JSON Schema sent to Gemini as `response_format.schema`, so the answer is structured JSON
 * rather than prose.
 *
 * It stays inside the subset the Gemini API documents for structured output: plain types, null
 * through a type list, `properties`, `required`, `items`, `enum` and `description`. Every property
 * is required and nullable instead of optional, and there are no length or count limits in the
 * schema, because the API ignores some of them and others make the schema too complex for it.
 * Those limits are enforced in validate.ts instead, on every answer.
 */

import { AI_CATEGORY_IDS, LEVELS, NOTICE_UNITS, RISK_KIND_IDS, UNIT_CHOICES } from "./categories.ts";

type JsonSchema = Record<string, unknown>;

export interface SchemaOptions {
  /**
   * With enums, the API itself keeps categories and units to the known lists. Without them the
   * lists are only described in words. Either way validate.ts rejects anything off the lists, so
   * the plain form is a safe fallback for a model that refuses the stricter schema.
   */
  enums: boolean;
}

export function buildResponseSchema({ enums }: SchemaOptions): JsonSchema {
  const choice = (values: readonly string[], description: string): JsonSchema =>
    enums ? { type: "string", enum: [...values], description } : { type: "string", description: `${description} One of: ${values.join(", ")}.` };
  const text = (description: string): JsonSchema => ({ type: "string", description });
  const textOrNull = (description: string): JsonSchema => ({ type: ["string", "null"], description });
  const numberOrNull = (description: string): JsonSchema => ({ type: ["number", "null"], description });
  const list = (description: string): JsonSchema => ({ type: "array", items: { type: "string" }, description });
  const object = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: "object", properties, required: Object.keys(properties) });

  const provision = object({
    ref: text('A short handle for this provision that is unique in this answer, such as "t1".'),
    page: { type: "integer", description: "The page number the quotation is on, as given in the page marker." },
    quote: text("Wording copied character for character from that one page. Contiguous, no ellipses, no paraphrase. Includes the figure when there is one."),
    category: choice(AI_CATEGORY_IDS, "The kind of provision."),
    label: text("A short name for the provision, using the contract's own name for a fee or clause where it has one."),
    value_number: numberOrNull("The figure the provision states, exactly as written, without symbols. Null when it states no single figure."),
    value_text: textOrNull("For a provision with no figure: a few words stating what it provides. Null when value_number is set."),
    unit: choice(UNIT_CHOICES, 'The unit of value_number. "none" when there is no figure.'),
    summary: text("One or two plain sentences saying what the provision means for the plan sponsor."),
    conditions: list("What must be true for the provision to apply, each as a short statement. Empty when none are stated."),
    exceptions: list("Carve-outs and exclusions stated for the provision. Empty when none are stated."),
    effective_date: textOrNull("The calendar date the provision starts to apply, as YYYY-MM-DD, only when the quoted wording states it. Otherwise null."),
    expiration_date: textOrNull("The calendar date the provision stops applying, as YYYY-MM-DD, only when the quoted wording states it. Otherwise null."),
    notice_value: numberOrNull("The length of a notice period stated in the quoted wording, as a number. Otherwise null."),
    notice_unit: choice([...NOTICE_UNITS, "none"], 'The unit of notice_value. "none" when there is no notice period.'),
    related_clauses: list('Other sections, exhibits or defined terms the wording points to, as the contract names them, such as "Section 9.2" or "Exhibit B".'),
    related_refs: list("The ref of each other provision in this answer that this one depends on, limits or is limited by."),
    confidence: choice(LEVELS, "How sure you are that the provision is read correctly."),
    needs_review: { type: "boolean", description: "True when a person should look closely: the wording is ambiguous, conflicts with another clause, or depends on something not in these pages." },
    review_reason: textOrNull("Why it needs review, in one sentence. Null when needs_review is false."),
  });

  const risk = object({
    kind: choice(RISK_KIND_IDS, "The kind of risk."),
    severity: choice(LEVELS, "How much it could matter to the plan sponsor."),
    title: text("A short headline for the observation."),
    explanation: text("Two to four plain sentences: what the quoted wording allows or requires and why that matters. No dollar estimates and no legal advice."),
    evidence: {
      type: "array",
      description: "The wording the observation rests on. At least one quotation.",
      items: object({
        page: { type: "integer", description: "The page number the quotation is on." },
        quote: text("Wording copied character for character from that one page."),
      }),
    },
    related_refs: list("The ref of each provision in this answer that the observation is about."),
    confidence: choice(LEVELS, "How sure you are of the observation."),
    needs_review: { type: "boolean", description: "True when you are unsure and a person should decide." },
  });

  return {
    type: "object",
    properties: {
      provisions: { type: "array", items: provision, description: "The provisions found in the supplied pages." },
      risks: { type: "array", items: risk, description: "Observations about risk in the supplied pages." },
    },
    required: ["provisions", "risks"],
  };
}
