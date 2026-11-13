import { useEffect, useState, type FormEvent } from "react";
import { DEFAULT_SETTINGS } from "@/analyzer";
import { Button, Card, CardHeader, Input, toast } from "@/components/ui";
import { THRESHOLD_LIMITS, useSettingsStore } from "@/store/useSettingsStore";

type Field = "feeTolerancePct" | "outlierSigma";

/** The number typed, or null when it is not a plain number inside the allowed range. */
function parseThreshold(text: string, field: Field): number | null {
  const typed = text.trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(typed)) return null;
  const value = Math.round(Number(typed) * 100) / 100;
  const { min, max } = THRESHOLD_LIMITS[field];
  return value >= min && value <= max ? value : null;
}

const rangeError = (field: Field): string =>
  `Enter a number from ${THRESHOLD_LIMITS[field].min} to ${THRESHOLD_LIMITS[field].max}, such as ${field === "feeTolerancePct" ? "2.5" : "3"}.`;

/** The two thresholds the checks use. They are kept on this device and apply to audits run from then on. */
export function ThresholdsCard() {
  const savedFee = useSettingsStore((s) => s.feeTolerancePct);
  const savedSigma = useSettingsStore((s) => s.outlierSigma);
  const setThresholds = useSettingsStore((s) => s.setThresholds);
  const resetThresholds = useSettingsStore((s) => s.resetThresholds);

  const [fee, setFee] = useState(String(savedFee));
  const [sigma, setSigma] = useState(String(savedSigma));
  const [checked, setChecked] = useState<Record<Field, boolean>>({ feeTolerancePct: false, outlierSigma: false });

  // Show what is saved whenever it changes: after a save here, or a change made in another tab.
  useEffect(() => {
    setFee(String(savedFee));
    setSigma(String(savedSigma));
    setChecked({ feeTolerancePct: false, outlierSigma: false });
  }, [savedFee, savedSigma]);

  const feeValue = parseThreshold(fee, "feeTolerancePct");
  const sigmaValue = parseThreshold(sigma, "outlierSigma");
  const unchanged = feeValue === savedFee && sigmaValue === savedSigma;
  const atDefaults =
    unchanged && savedFee === DEFAULT_SETTINGS.feeTolerancePct && savedSigma === DEFAULT_SETTINGS.outlierSigma;

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    setChecked({ feeTolerancePct: true, outlierSigma: true });
    if (feeValue === null || sigmaValue === null || unchanged) return;
    setThresholds({ feeTolerancePct: feeValue, outlierSigma: sigmaValue });
    toast.success("Thresholds saved. They apply to audits you run from now on.");
  }

  function onReset(): void {
    resetThresholds();
    setFee(String(DEFAULT_SETTINGS.feeTolerancePct));
    setSigma(String(DEFAULT_SETTINGS.outlierSigma));
    setChecked({ feeTolerancePct: false, outlierSigma: false });
    toast.success("Thresholds are back to the defaults.");
  }

  return (
    <Card>
      <CardHeader
        title="Check thresholds"
        description="How strict the checks are. Kept on this device and used for audits you run from now on. Reports you already have do not change."
      />
      <form onSubmit={onSubmit} noValidate>
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Input
            label="Fee tolerance"
            value={fee}
            suffix="%"
            inputMode="decimal"
            autoComplete="off"
            hint={`Fee differences smaller than this are ignored. The default is ${DEFAULT_SETTINGS.feeTolerancePct}.`}
            error={checked.feeTolerancePct && feeValue === null ? rangeError("feeTolerancePct") : undefined}
            onChange={(e) => setFee(e.target.value)}
            onBlur={() => setChecked((c) => ({ ...c, feeTolerancePct: true }))}
          />
          <Input
            label="Unusual charge threshold"
            value={sigma}
            suffix="SD"
            inputMode="decimal"
            autoComplete="off"
            hint={`A charge counts as unusually high when it is more than this many standard deviations above the average for its category. The default is ${DEFAULT_SETTINGS.outlierSigma}.`}
            error={checked.outlierSigma && sigmaValue === null ? rangeError("outlierSigma") : undefined}
            onChange={(e) => setSigma(e.target.value)}
            onBlur={() => setChecked((c) => ({ ...c, outlierSigma: true }))}
          />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="submit" disabled={unchanged}>
            Save thresholds
          </Button>
          <Button variant="secondary" disabled={atDefaults} onClick={onReset}>
            Reset to defaults
          </Button>
        </div>
      </form>
    </Card>
  );
}
