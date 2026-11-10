import { Link } from "react-router-dom";
import { FilePlus2, FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyBowl } from "@/components/illustrations/EmptyBowl";
import { Button, Card, buttonClasses, toast } from "@/components/ui";

const STATS = [
  { label: "Audits run", value: "0", hint: "Saved on this device" },
  { label: "Estimated exposure", value: "$0", hint: "Across all open findings" },
  { label: "Open findings", value: "0", hint: "Waiting for your review" },
];

/** Phase 0 placeholder. Real stats and the recent audits list arrive in Phase 4. */
export default function Dashboard() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Check healthcare insurance contracts for hidden fees, unusual charges and pricing problems."
      />

      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-3">
        {STATS.map((s) => (
          <Card key={s.label}>
            <p className="text-sm text-muted">{s.label}</p>
            <p className="num mt-2 text-xl font-semibold text-ink">{s.value}</p>
            <p className="mt-1 text-xs text-muted">{s.hint}</p>
          </Card>
        ))}
      </section>

      <Card className="mt-6 flex flex-col items-center py-12 text-center">
        <EmptyBowl className="h-36 w-auto" />
        <h2 className="mt-6 text-lg font-semibold">No audits yet</h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          Upload a contract PDF and an optional claims file. ContractSoup reads both in your browser and lists
          anything worth a closer look, with the page and clause as evidence.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/audit/new" className={buttonClasses("primary", "lg", "gap-2")}>
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            Start new audit
          </Link>
          <Button
            variant="secondary"
            size="lg"
            icon={<FlaskConical className="h-4 w-4" />}
            onClick={() => toast.info("Sample audit data arrives in Phase 1.")}
          >
            Try a sample audit
          </Button>
        </div>
      </Card>
    </>
  );
}
