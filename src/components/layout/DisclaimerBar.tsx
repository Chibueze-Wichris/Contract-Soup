import { Scale } from "lucide-react";
import { DISCLAIMER } from "@/lib/nav";

/** Persistent legal note. Sticks to the bottom of the viewport, above the mobile tab bar. */
export function DisclaimerBar() {
  return (
    <footer
      role="contentinfo"
      className="sticky bottom-16 z-20 border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur sm:px-6 md:bottom-0 lg:px-8"
    >
      <p className="flex items-center gap-2 text-xs text-muted">
        <Scale className="h-3.5 w-3.5 shrink-0 text-amber" aria-hidden="true" />
        {DISCLAIMER}
      </p>
    </footer>
  );
}
