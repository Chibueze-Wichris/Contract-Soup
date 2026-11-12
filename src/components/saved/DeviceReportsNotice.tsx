import { useEffect, useState } from "react";
import { Button, Modal, Notice, toast } from "@/components/ui";
import { AuditStorageError, auditRepo } from "@/lib/auditRepo";
import { plural } from "@/lib/format";

/**
 * Account builds only. Reports made before sign-in was switched on sit in this browser,
 * not in anyone's account, so no list shows them. This offers to move them in.
 */
export function DeviceReportsNotice({ onMoved }: { onMoved: () => void }) {
  const [count, setCount] = useState(0);
  const [working, setWorking] = useState<"move" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let current = true;
    void auditRepo.deviceReportCount().then((n) => {
      if (current) setCount(n);
    });
    return () => {
      current = false;
    };
  }, []);

  if (count === 0) return null;
  const reports = plural(count, "report");

  async function move(): Promise<void> {
    setWorking("move");
    try {
      const { moved, alreadyThere } = await auditRepo.moveDeviceReportsToAccount();
      toast.success(
        alreadyThere > 0
          ? `Moved ${plural(moved, "report")} into your account. ${plural(alreadyThere, "report")} ${alreadyThere === 1 ? "was" : "were"} already there.`
          : `Moved ${plural(moved, "report")} into your account.`,
      );
    } catch (err) {
      toast.error(err instanceof AuditStorageError ? err.message : "The reports could not be moved. Try again.");
    }
    // Whatever happened, show what is still on this device and what reached the account.
    setCount(await auditRepo.deviceReportCount());
    setWorking(null);
    onMoved();
  }

  async function remove(): Promise<void> {
    setWorking("delete");
    try {
      await auditRepo.removeDeviceReports();
      toast.success(`Deleted ${reports} from this device.`);
      setConfirmDelete(false);
    } catch (err) {
      toast.error(err instanceof AuditStorageError ? err.message : "The reports could not be deleted. Try again.");
    }
    setCount(await auditRepo.deviceReportCount());
    setWorking(null);
  }

  return (
    <>
      <Notice
        tone="info"
        className="mb-6"
        title={`${reports} ${count === 1 ? "is" : "are"} saved on this device, not in your account`}
      >
        <p>
          {count === 1
            ? "It was saved in this browser before reports were kept in your account, so it does not show in the list below."
            : "They were saved in this browser before reports were kept in your account, so they do not show in the list below."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" loading={working === "move"} disabled={working !== null} onClick={() => void move()}>
            Move to my account
          </Button>
          <Button variant="secondary" size="sm" disabled={working !== null} onClick={() => setConfirmDelete(true)}>
            Delete from this device
          </Button>
        </div>
      </Notice>

      <Modal
        open={confirmDelete}
        onClose={working ? () => undefined : () => setConfirmDelete(false)}
        title={`Delete ${reports} from this device`}
        description={
          count === 1
            ? "It is not in your account, so this removes it for good. It cannot be undone."
            : "They are not in your account, so this removes them for good. It cannot be undone."
        }
        size="sm"
        footer={
          <>
            <Button variant="secondary" disabled={working !== null} data-autofocus onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={working === "delete"} onClick={() => void remove()}>
              Delete {reports}
            </Button>
          </>
        }
      />
    </>
  );
}
