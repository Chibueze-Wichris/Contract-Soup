import { Check } from "lucide-react";
import { WIZARD_STEPS } from "./steps";
import { cn } from "@/lib/cn";
import { canOpenStep, useDraftAuditStore } from "@/store/useDraftAuditStore";

/** The four wizard steps. Visited steps can be reopened; later ones unlock as each step is completed. */
export function Stepper() {
  const step = useDraftAuditStore((s) => s.step);
  const goToStep = useDraftAuditStore((s) => s.goToStep);
  // One short string, so the stepper only re-renders when a step locks or unlocks.
  const open = useDraftAuditStore((s) => WIZARD_STEPS.map((m) => (canOpenStep(s, m.step) ? "1" : "0")).join(""));

  return (
    <nav aria-label="Audit steps" className="@container mb-6">
      <ol className="grid grid-cols-4 gap-2 @xl:gap-3">
        {WIZARD_STEPS.map(({ step: n, title, short }) => {
          const current = n === step;
          const done = n < step;
          const available = open[n - 1] === "1";
          return (
            <li key={n}>
              <button
                type="button"
                onClick={() => goToStep(n)}
                disabled={!available && !current}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex h-full w-full flex-col items-center gap-2 rounded-xl border px-2 py-3 text-center transition-colors duration-150",
                  "@xl:flex-row @xl:gap-3 @xl:px-4 @xl:text-left",
                  current ? "border-brand bg-surface shadow-soft" : "border-line bg-surface-2",
                  available && !current && "hover:border-line-strong hover:bg-surface",
                  !available && !current && "cursor-not-allowed",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "num flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    current
                      ? "bg-brand text-brand-on"
                      : done
                        ? "bg-brand-soft text-brand"
                        : "border border-line bg-surface text-muted",
                  )}
                >
                  {done ? <Check className="h-4 w-4" /> : n}
                </span>
                <span className={cn("min-w-0 text-xs font-medium @xl:text-sm", current || done ? "text-ink" : "text-muted")}>
                  <span className="sr-only">
                    Step {n} of {WIZARD_STEPS.length}:{" "}
                  </span>
                  <span className="@xl:hidden">{short}</span>
                  <span className="hidden @xl:inline">{title}</span>
                  <span className="sr-only">
                    {current ? ", current step" : done ? ", completed" : available ? "" : ", not available yet"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
