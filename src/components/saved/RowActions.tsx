import { Copy, Download, Loader2, Pencil, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type RowAction = "rename" | "duplicate" | "download" | "delete";

const ACTIONS: readonly { action: RowAction; label: string; Icon: LucideIcon; danger?: boolean }[] = [
  { action: "rename", label: "Rename", Icon: Pencil },
  { action: "duplicate", label: "Duplicate", Icon: Copy },
  { action: "download", label: "Download PDF", Icon: Download },
  { action: "delete", label: "Delete", Icon: Trash2, danger: true },
];

interface RowActionsProps {
  reportName: string;
  /** The action under way on this report, if any. The other buttons wait for it. */
  busy: RowAction | null;
  onAction: (action: RowAction) => void;
  className?: string;
}

/** The four things that can be done to a saved report. Each button names the report for screen readers. */
export function RowActions({ reportName, busy, onAction, className }: RowActionsProps) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {ACTIONS.map(({ action, label, Icon, danger }) => (
        <button
          key={action}
          type="button"
          title={label}
          aria-label={`${label}: ${reportName}`}
          disabled={busy !== null}
          onClick={() => onAction(action)}
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150",
            "hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50",
            danger ? "hover:text-high-ink" : "hover:text-ink",
          )}
        >
          {busy === action ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Icon className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  );
}
