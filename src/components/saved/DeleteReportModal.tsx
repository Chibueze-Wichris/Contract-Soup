import { useState } from "react";
import { Button, Modal, Notice } from "@/components/ui";
import type { AuditListItem } from "@/lib/auditRecord";
import { AuditStorageError, auditRepo } from "@/lib/auditRepo";
import { STORAGE_TEXT } from "@/lib/storageText";

interface DeleteReportModalProps {
  /** The report to delete, or null when the dialog is closed. */
  report: AuditListItem | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

function DeleteDialog({ report, onClose, onDeleted }: DeleteReportModalProps & { report: AuditListItem }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function confirm(): Promise<void> {
    setDeleting(true);
    setError("");
    try {
      await auditRepo.remove(report.id);
      onDeleted(report.id);
    } catch (err) {
      setError(err instanceof AuditStorageError ? err.message : "The report could not be deleted. Try again.");
      setDeleting(false);
    }
  }

  return (
    <Modal
      open
      onClose={deleting ? () => undefined : onClose}
      title="Delete this report"
      description={`This removes the report ${STORAGE_TEXT.removedFrom}. It cannot be undone.`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" disabled={deleting} data-autofocus onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" loading={deleting} onClick={() => void confirm()}>
            Delete report
          </Button>
        </>
      }
    >
      <p className="break-words font-medium text-ink">{report.name}</p>
      <p className="mt-1 break-words text-muted [overflow-wrap:anywhere]">{report.contractFileName}</p>
      {error ? (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      ) : null}
    </Modal>
  );
}

/** Asks before a saved report is deleted, since there is no way to get it back. */
export function DeleteReportModal({ report, onClose, onDeleted }: DeleteReportModalProps) {
  return report ? <DeleteDialog key={report.id} report={report} onClose={onClose} onDeleted={onDeleted} /> : null;
}
