import { ChevronRight, StickyNote } from "lucide-react";
import type { Finding } from "@/analyzer";
import { findingTypeLabel } from "@/analyzer/categories";
import { SeverityBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { impactText } from "@/lib/findings";
import { StatusBadge } from "./StatusBadge";

interface FindingRowProps {
  finding: Finding;
  onOpen: (findingId: string) => void;
}

/** One finding in the list. The whole row is a button that opens its details. */
export function FindingRow({ finding, onOpen }: FindingRowProps) {
  const dismissed = finding.status === "dismissed";
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(finding.id)}
        className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-offset-[-2px] sm:px-6"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <SeverityBadge severity={finding.severity} />
            <span className="text-xs text-muted">{findingTypeLabel(finding.type)}</span>
          </span>
          <span className={cn("mt-1.5 block break-words text-sm font-medium", dismissed ? "text-muted" : "text-ink")}>
            {finding.title}
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge status={finding.status} />
            {/* On a phone the estimate sits here, so the title keeps the full width. */}
            <span className={cn("num text-sm font-semibold sm:hidden", dismissed ? "text-muted" : "text-ink")}>
              {impactText(finding)}
              {finding.estimatedImpactUSD !== null ? (
                <span className="ml-1 text-xs font-normal text-muted">{dismissed ? "not counted" : "estimated"}</span>
              ) : null}
            </span>
            {finding.note ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <StickyNote className="h-3.5 w-3.5" aria-hidden="true" />
                Note added
              </span>
            ) : null}
          </span>
        </span>
        <span className="hidden shrink-0 text-right sm:block">
          <span className={cn("num block text-sm font-semibold", dismissed ? "text-muted" : "text-ink")}>{impactText(finding)}</span>
          {finding.estimatedImpactUSD !== null ? (
            <span className="mt-0.5 block text-xs text-muted">{dismissed ? "not counted" : "estimated"}</span>
          ) : null}
        </span>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      </button>
    </li>
  );
}
