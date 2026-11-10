import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** False when the env vars are missing, so the app keeps working in local-only mode. */
export const isSupabaseConfigured = Boolean(url && key);

/**
 * Only the publishable (anon) key belongs in the browser. Row-level security
 * in the database is what actually protects the data. NEVER put the
 * service_role / secret key in this project.
 */
export const supabase = isSupabaseConfigured
  ? createClient(url!, key!, {
      auth: {
        // PKCE puts a ?code= in the query string, which works with HashRouter.
        // The older implicit flow puts tokens in the #hash and collides with "#/routes".
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
