import type { ReactNode } from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type NoticeTone = "info" | "success" | "warning" | "error";

const tones: Record<NoticeTone, { box: string; icon: string; Icon: LucideIcon }> = {
  info: { box: "bg-brand-soft", icon: "text-brand", Icon: Info },
  success: { box: "bg-success-soft", icon: "text-success-ink", Icon: CheckCircle2 },
  warning: { box: "bg-amber-soft", icon: "text-medium-ink", Icon: AlertTriangle },
  error: { box: "bg-high-soft", icon: "text-high-ink", Icon: AlertOctagon },
};

interface NoticeProps {
  tone?: NoticeTone;
  /** Optional bold first line. */
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Errors are announced straight away. Pass "status" for a polite announcement; leave unset for static text. */
  role?: "alert" | "status";
}

/** Inline message block. Each tone has its own icon, so the meaning never depends on colour alone. */
export function Notice({ tone = "info", title, children, className, role }: NoticeProps) {
  const { box, icon, Icon } = tones[tone];
  return (
    <div
      role={role ?? (tone === "error" ? "alert" : undefined)}
      className={cn("flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm text-ink", box, className)}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1 break-words">
        {title ? <p className="font-medium">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}
