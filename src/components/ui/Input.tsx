import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label?: string;
  hint?: ReactNode;
  error?: string;
  /** Short adornment inside the left edge, such as "$". */
  prefix?: ReactNode;
  /** Short adornment inside the right edge, such as "%". */
  suffix?: ReactNode;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, prefix, suffix, hideLabel, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <label
          htmlFor={inputId}
          className={cn("mb-1.5 block text-sm font-medium text-ink", hideLabel && "sr-only")}
        >
          {label}
        </label>
      ) : null}
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">
            {prefix}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            "h-10 w-full rounded-lg border bg-surface px-3 text-sm text-ink placeholder:text-muted/70",
            "transition-[border-color,box-shadow] duration-150 ease-out",
            "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand",
            "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60",
            error ? "border-high" : "border-line hover:border-line-strong",
            prefix ? "pl-7" : null,
            suffix ? "pr-9" : null,
          )}
          {...rest}
        />
        {suffix ? (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">
            {suffix}
          </span>
        ) : null}
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
