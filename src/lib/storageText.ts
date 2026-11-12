import { STORAGE_PLACE } from "@/lib/auditRepo";

const account = STORAGE_PLACE === "account";

/** Wording for where reports are kept, so no screen says "on this device" when they go to an account. */
export const STORAGE_TEXT = {
  /** "is saved …" */
  savedIn: account ? "in your account" : "on this device",
  /** "could not be saved …" */
  savedTo: account ? "to your account" : "on this device",
  /** "is removed …" */
  removedFrom: account ? "from your account" : "from this device",
} as const;
