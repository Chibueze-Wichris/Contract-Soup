import { useId, useState, type FormEvent } from "react";
import { Button, Input, Modal } from "@/components/ui";
import { AUDIT_NAME_LIMIT, cleanAuditName, type AuditListItem } from "@/lib/auditRecord";
import { AuditStorageError, auditRepo } from "@/lib/auditRepo";

interface RenameReportModalProps {
  /** The report being renamed, or null when the dialog is closed. */
  report: AuditListItem | null;
  onClose: () => void;
  onRenamed: (id: string, name: string) => void;
}

function RenameForm({ report, onClose, onRenamed }: RenameReportModalProps & { report: AuditListItem }) {
  const formId = useId();
  const [name, setName] = useState(report.name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const clean = cleanAuditName(name);
    if (!clean) {
      setError("Enter a name for the report.");
      return;
    }
    if (clean === report.name) {
      onClose();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await auditRepo.rename(report.id, clean);
      onRenamed(report.id, clean);
    } catch (err) {
      setError(err instanceof AuditStorageError ? err.message : "The name could not be saved. Try again.");
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={saving ? () => undefined : onClose}
      title="Rename report"
      size="sm"
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            Save name
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void onSubmit(e)}>
        <Input
          label="Report name"
          value={name}
          maxLength={AUDIT_NAME_LIMIT}
          autoComplete="off"
          data-autofocus
          error={error || undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          onFocus={(e) => e.target.select()}
        />
      </form>
    </Modal>
  );
}

/** Dialog for giving a saved report a new name. */
export function RenameReportModal({ report, onClose, onRenamed }: RenameReportModalProps) {
  return report ? <RenameForm key={report.id} report={report} onClose={onClose} onRenamed={onRenamed} /> : null;
}
