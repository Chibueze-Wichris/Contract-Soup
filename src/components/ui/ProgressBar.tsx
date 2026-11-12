import { cn } from "@/lib/cn";

interface ProgressBarProps {
  /** Fraction from 0 to 1. Pass null while the total is not known yet. */
  value: number | null;
  /** Accessible name, e.g. "Reading contract.pdf". */
  label: string;
  /** Read out instead of the bare percentage, e.g. "Page 120 of 480". */
  valueText?: string;
  className?: string;
}

/** Thin progress bar. With value null it pulses at full width instead of filling. */
export function ProgressBar({ value, label, valueText, className }: ProgressBarProps) {
  const percent = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={valueText}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-line", className)}
    >
      <div
        className={cn(
          "h-full rounded-full bg-brand transition-[width] duration-200 ease-out",
          percent === null && "animate-pulse opacity-60",
        )}
        style={{ width: `${percent ?? 100}%` }}
      />
    </div>
  );
}
