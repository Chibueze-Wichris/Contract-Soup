/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** "local" (default) or "remote". Remote is a stub for now. */
  readonly VITE_ANALYZER_MODE?: string;
  readonly VITE_ANALYZER_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
