import type { WizardStep } from "@/store/useDraftAuditStore";

export interface WizardStepMeta {
  step: WizardStep;
  title: string;
  /** One word for the stepper on narrow screens. */
  short: string;
}

export const WIZARD_STEPS: readonly WizardStepMeta[] = [
  { step: 1, title: "Upload contract", short: "Contract" },
  { step: 2, title: "Review contract terms", short: "Terms" },
  { step: 3, title: "Upload claims", short: "Claims" },
  { step: 4, title: "Run audit", short: "Run" },
];
