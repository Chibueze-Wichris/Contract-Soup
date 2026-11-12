import { forwardRef, useId, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: ReactNode;
  error?: string;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
}

/** Multi-line text field styled to match Input. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, hideLabel, className, id, rows = 3, ...rest },
  ref,
) {
  const autoId = useId();
  const areaId = id ?? autoId;
  const hintId = `${areaId}-hint`;
  const errorId = `${areaId}-error`;

  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <label
          htmlFor={areaId}
          className={cn("mb-1.5 block text-sm font-medium text-ink", hideLabel && "sr-only")}
        >
          {label}
        </label>
      ) : null}
      <textarea
        ref={ref}
        id={areaId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={cn(
          "block w-full resize-y rounded-lg border bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70",
          "transition-[border-color,box-shadow] duration-150 ease-out",
          "focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand",
          "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60",
          error ? "border-high" : "border-line hover:border-line-strong",
        )}
        {...rest}
      />
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
