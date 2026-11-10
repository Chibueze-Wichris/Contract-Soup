import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthState {
  session: Session | null;
  user: User | null;
  /** True until the first session check finishes. */
  loading: boolean;
  /** True when the user arrived from a password-reset email. */
  recovery: boolean;
  clearRecovery: () => void;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  loading: Boolean(supabase),
  recovery: false,
  clearRecovery: () => set({ recovery: false }),
  signOut: async () => {
    await supabase?.auth.signOut();
    set({ session: null, user: null, recovery: false });
  },
}));

let started = false;

/** Call once at startup. Keeps the store in sync with Supabase Auth. */
export function initAuth(): void {
  if (started || !supabase) return;
  started = true;

  supabase.auth.getSession().then(({ data }) => {
    useAuthStore.setState({ session: data.session, user: data.session?.user ?? null, loading: false });
  });

  supabase.auth.onAuthStateChange((event, session) => {
    useAuthStore.setState({
      session,
      user: session?.user ?? null,
      loading: false,
      ...(event === "PASSWORD_RECOVERY" ? { recovery: true } : {}),
    });
  });
}
