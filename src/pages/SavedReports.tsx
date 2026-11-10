import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyBowl } from "@/components/illustrations/EmptyBowl";
import { Card, buttonClasses } from "@/components/ui";

/** Phase 0 placeholder. The searchable table over IndexedDB arrives in Phase 4. */
export default function SavedReports() {
  return (
    <>
      <PageHeader title="Saved reports" description="Audits saved on this device. Nothing is stored on a server." />
      <Card className="flex flex-col items-center py-12 text-center">
        <EmptyBowl className="h-32 w-auto" />
        <h2 className="mt-6 text-lg font-semibold">No saved reports</h2>
        <p className="mt-2 max-w-sm text-sm text-muted">Finished audits appear here so you can reopen, rename or export them.</p>
        <Link to="/audit/new" className={buttonClasses("primary", "md", "mt-5")}>
          Start new audit
        </Link>
      </Card>
    </>
  );
}
