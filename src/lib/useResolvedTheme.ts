import { useEffect, useSyncExternalStore } from "react";
import { applyTheme, useThemeStore, type ResolvedTheme } from "@/store/useThemeStore";

const QUERY = "(prefers-color-scheme: dark)";

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

const getSnapshot = (): boolean => window.matchMedia(QUERY).matches;

/**
 * Returns the theme currently shown. When the preference is "system",
 * it also follows live changes to the operating system setting.
 */
export function useResolvedTheme(): ResolvedTheme {
  const preference = useThemeStore((s) => s.preference);
  const systemDark = useSyncExternalStore(subscribe, getSnapshot, () => false);

  useEffect(() => {
    if (preference === "system") applyTheme("system");
  }, [preference, systemDark]);

  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}
