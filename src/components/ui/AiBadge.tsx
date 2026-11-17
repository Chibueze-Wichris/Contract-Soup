import { Eye, Sparkles } from "lucide-react";
import { Badge } from "./Badge";

/** Marks something Gemini read or noticed, so it is never mistaken for a result of the money checks. */
export function AiBadge({ children = "Read by Gemini", className }: { children?: string; className?: string }) {
  return (
    <Badge tone="brand" icon={<Sparkles className="h-3 w-3" />} className={className}>
      {children}
    </Badge>
  );
}

/** Marks a term or an observation the AI reader was unsure of, or whose quoted wording failed an automatic check. */
export function NeedsReviewBadge({ className }: { className?: string }) {
  return (
    <Badge tone="amber" icon={<Eye className="h-3 w-3" />} className={className}>
      Needs review
    </Badge>
  );
}
