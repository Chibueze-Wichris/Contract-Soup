import { CheckCircle2, CircleDashed, CircleSlash, Scale, type LucideIcon } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui";
import { statusLabel, type FindingStatus } from "@/lib/findings";

const LOOKS: Record<FindingStatus, { tone: BadgeTone; Icon: LucideIcon }> = {
  open: { tone: "amber", Icon: CircleDashed },
  confirmed: { tone: "brand", Icon: CheckCircle2 },
  legal_review: { tone: "low", Icon: Scale },
  dismissed: { tone: "neutral", Icon: CircleSlash },
};

/** Where a finding stands in the review. Each status has its own icon and words, never colour alone. */
export function StatusBadge({ status, className }: { status: FindingStatus; className?: string }) {
  const { tone, Icon } = LOOKS[status];
  return (
    <Badge tone={tone} icon={<Icon className="h-3 w-3" />} className={className}>
      {statusLabel(status)}
    </Badge>
  );
}
