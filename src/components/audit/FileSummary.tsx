import type { ReactNode } from "react";
import { Badge } from "@/components/ui";

interface FileSummaryProps {
  icon: ReactNode;
  name: string;
  /** Facts about the file, e.g. ["12 pages", "1.2 MB"]. Shown on one line, separated by dots. */
  details: readonly string[];
  /** Marks the built-in sample files. */
  sample?: boolean;
  /** A button on the right, such as Remove or Cancel. It moves under the name when there is no room beside it. */
  action?: ReactNode;
  /** Shown under the details, such as a progress bar. */
  children?: ReactNode;
}

/** A loaded (or loading) file: icon, name, a line of facts and one action. */
export function FileSummary({ icon, name, details, sample = false, action, children }: FileSummaryProps) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words text-sm font-medium text-ink [overflow-wrap:anywhere]">{name}</span>
            {sample ? <Badge tone="amber">Sample</Badge> : null}
          </p>
          {details.length > 0 ? <p className="num mt-0.5 text-xs text-muted">{details.join(" · ")}</p> : null}
        </div>
        {action ? <div className="ml-auto shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
