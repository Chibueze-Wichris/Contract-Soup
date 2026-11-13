/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** "gemini" offers the Gemini reader as a choice on each audit. It is a switch, not a key. */
  readonly VITE_ANALYZER_MODE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
