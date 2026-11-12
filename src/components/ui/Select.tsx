import { forwardRef, useId, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: ReactNode;
  error?: string;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
}

/** Native select styled to match Input. Pass <option> elements as children. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, hideLabel, className, id, children, ...rest },
  ref,
) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hintId = `${selectId}-hint`;
  const errorId = `${selectId}-error`;

  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <label
          htmlFor={selectId}
          className={cn("mb-1.5 block text-sm font-medium text-ink", hideLabel && "sr-only")}
        >
          {label}
        </label>
      ) : null}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            "h-10 w-full appearance-none truncate rounded-lg border bg-surface pl-3 pr-9 text-sm text-ink",
            "transition-[border-color,box-shadow] duration-150 ease-out",
            "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand",
            "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60",
            error ? "border-high" : "border-line hover:border-line-strong",
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
          aria-hidden="true"
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-high-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
