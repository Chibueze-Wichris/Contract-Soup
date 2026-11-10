import { Moon, Sun } from "lucide-react";
import { useThemeStore } from "@/store/useThemeStore";
import { useResolvedTheme } from "@/lib/useResolvedTheme";

export function ThemeToggle() {
  const toggle = useThemeStore((s) => s.toggle);
  const theme = useResolvedTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted shadow-soft transition-colors duration-150 hover:border-line-strong hover:text-ink"
    >
      {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}
