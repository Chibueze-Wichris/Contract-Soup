import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Icon shown before the label. Decorative, so hidden from screen readers. */
  icon?: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-brand-on hover:bg-brand-hover shadow-soft border border-transparent",
  secondary:
    "bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2 shadow-soft",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-brand-soft hover:text-brand",
  destructive:
    "bg-high text-white hover:brightness-90 shadow-soft border border-transparent",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-base gap-2",
};

/** Class string for rendering router links or anchors that look like buttons. */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string): string {
  return cn(
    "inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,filter] duration-150 ease-out",
    variants[variant],
    sizes[size],
    extra,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium whitespace-nowrap select-none",
        "transition-[background-color,border-color,color,filter] duration-150 ease-out",
        "disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-offset-2",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : icon ? (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
});
