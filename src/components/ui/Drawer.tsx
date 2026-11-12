import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/useFocusTrap";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Controls pinned to the bottom of the panel. */
  footer?: ReactNode;
  size?: "md" | "lg";
}

const widths = { md: "sm:max-w-md", lg: "sm:max-w-xl" } as const;

/** Side panel that slides in from the right. Behaves like Modal: focus trap, Escape to close, scroll lock, focus restore. */
export function Drawer({ open, onClose, title, description, children, footer, size = "md" }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useFocusTrap(panelRef, open, onClose);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 animate-fade-in bg-[var(--overlay)]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "relative flex h-full w-full animate-slide-in-right flex-col border-l border-line bg-surface shadow-pop",
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="break-words text-lg font-semibold text-ink">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-sm text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-mr-2 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 text-sm sm:px-6">{children}</div>
        {footer ? (
          <div className="border-t border-line px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
