import { PencilLine, SignalHigh, SignalLow, SignalMedium, type LucideIcon } from "lucide-react";
import type { ContractTerm } from "@/analyzer";
import { Badge, type BadgeTone } from "@/components/ui";
import { isManualTerm } from "@/lib/terms";

const LEVELS: Record<ContractTerm["confidence"], { tone: BadgeTone; label: string; Icon: LucideIcon }> = {
  high: { tone: "brand", label: "High confidence", Icon: SignalHigh },
  medium: { tone: "amber", label: "Medium confidence", Icon: SignalMedium },
  low: { tone: "neutral", label: "Low confidence", Icon: SignalLow },
};

/** How sure the reader was about a term. The words and the icon change with the level, never the colour alone. */
export function ConfidenceBadge({ term, className }: { term: Pick<ContractTerm, "id" | "confidence">; className?: string }) {
  if (isManualTerm(term)) {
    return (
      <Badge icon={<PencilLine className="h-3 w-3" />} className={className}>
        Added by you
      </Badge>
    );
  }
  const { tone, label, Icon } = LEVELS[term.confidence];
  return (
    <Badge tone={tone} icon={<Icon className="h-3 w-3" />} className={className}>
      {label}
    </Badge>
  );
}
