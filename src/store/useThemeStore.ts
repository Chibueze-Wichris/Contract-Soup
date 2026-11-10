import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

interface ThemeState {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** Flip between light and dark based on what is currently shown. */
  toggle: () => void;
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

export function applyTheme(pref: ThemePreference): void {
  document.documentElement.setAttribute("data-theme", resolveTheme(pref));
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      preference: "system",
      setPreference: (preference) => {
        applyTheme(preference);
        set({ preference });
      },
      toggle: () => {
        const next: ResolvedTheme = resolveTheme(get().preference) === "dark" ? "light" : "dark";
        applyTheme(next);
        set({ preference: next });
      },
    }),
    // Key is read by the inline script in index.html. Keep both in sync.
    { name: "contractsoup-theme", partialize: (s) => ({ preference: s.preference }) },
  ),
);
