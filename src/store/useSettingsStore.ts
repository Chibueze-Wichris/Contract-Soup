import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_SETTINGS, type Settings } from "@/analyzer";

/** The range each threshold may take. Outside it the checks stop being useful. */
export const THRESHOLD_LIMITS = {
  feeTolerancePct: { min: 0, max: 25 },
  outlierSigma: { min: 1, max: 6 },
} as const;

const inRange = (value: unknown, { min, max }: { min: number; max: number }): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

/** Whatever comes in, a usable pair of thresholds comes out: anything missing or out of range becomes the default. */
export function sanitizeSettings(value: unknown): Settings {
  const v = (typeof value === "object" && value !== null ? value : {}) as Partial<Record<keyof Settings, unknown>>;
  return {
    feeTolerancePct: inRange(v.feeTolerancePct, THRESHOLD_LIMITS.feeTolerancePct)
      ? v.feeTolerancePct
      : DEFAULT_SETTINGS.feeTolerancePct,
    outlierSigma: inRange(v.outlierSigma, THRESHOLD_LIMITS.outlierSigma) ? v.outlierSigma : DEFAULT_SETTINGS.outlierSigma,
  };
}

interface SettingsState extends Settings {
  setThresholds: (next: Settings) => void;
  resetThresholds: () => void;
}

const STORAGE_KEY = "contractsoup-settings";

/** The check thresholds, kept on this device like the theme. They apply to audits run from then on. */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      setThresholds: (next) => set(sanitizeSettings(next)),
      resetThresholds: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: (s) => ({ feeTolerancePct: s.feeTolerancePct, outlierSigma: s.outlierSigma }),
      // What was stored may be old or edited by hand, so it is checked on the way in.
      merge: (stored, current) => ({ ...current, ...sanitizeSettings(stored) }),
    },
  ),
);

// Follow a change made in another tab, so the thresholds shown are always the ones a run will use.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) void useSettingsStore.persist.rehydrate();
  });
}

/** The thresholds a run uses. */
export function currentSettings(): Settings {
  const { feeTolerancePct, outlierSigma } = useSettingsStore.getState();
  return { feeTolerancePct, outlierSigma };
}
