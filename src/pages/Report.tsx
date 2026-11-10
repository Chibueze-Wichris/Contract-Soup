import { useParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui";

/** Phase 0 placeholder. The report and findings UI are built in Phase 3. */
export default function Report() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <PageHeader title="Audit report" description="Findings, evidence and the calculation behind each number." />
      <Card>
        <p className="text-sm text-muted">
          Report <span className="num font-medium text-ink">{id}</span> will render here in Phase 3.
        </p>
      </Card>
    </>
  );
}
