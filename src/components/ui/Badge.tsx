import type { ReactNode } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "brand" | "amber" | "high" | "medium" | "low" | "success";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  brand: "bg-brand-soft text-brand border-transparent",
  amber: "bg-amber-soft text-medium-ink border-transparent",
  high: "bg-high-soft text-high-ink border-transparent",
  medium: "bg-medium-soft text-medium-ink border-transparent",
  low: "bg-low-soft text-low-ink border-transparent",
  success: "bg-success-soft text-success-ink border-transparent",
};

interface BadgeProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-4 whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {icon ? (
        <span className="inline-flex" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
  );
}

export type Severity = "high" | "medium" | "low";

const severityMeta: Record<Severity, { label: string; icon: ReactNode }> = {
  high: { label: "High", icon: <AlertOctagon className="h-3 w-3" /> },
  medium: { label: "Medium", icon: <AlertTriangle className="h-3 w-3" /> },
  low: { label: "Low", icon: <Info className="h-3 w-3" /> },
};

/** Severity is never colour-only: each level has its own icon and text label. */
export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const meta = severityMeta[severity];
  return (
    <Badge tone={severity} icon={meta.icon} className={className}>
      {meta.label}
    </Badge>
  );
}

export function SuccessBadge({ children }: { children: ReactNode }) {
  return (
    <Badge tone="success" icon={<CheckCircle2 className="h-3 w-3" />}>
      {children}
    </Badge>
  );
}
