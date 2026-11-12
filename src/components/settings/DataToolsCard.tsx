import { useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Download, Trash2, Upload, XCircle } from "lucide-react";
import { Button, Card, CardHeader, Modal, Notice, toast, type NoticeTone } from "@/components/ui";
import { backupFileName, buildBackup, parseBackup } from "@/lib/auditRecord";
import { AuditStorageError, STORAGE_PLACE, auditRepo, type StorageCheckStep } from "@/lib/auditRepo";
import { downloadTextFile } from "@/lib/download";
import { plural } from "@/lib/format";
import { STORAGE_TEXT } from "@/lib/storageText";
import { useAuditList } from "@/lib/useAuditList";

/** A backup far larger than this is not one of ours. */
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

type Job = "export" | "import" | "delete" | "check";

const problem = (err: unknown, fallback: string): string => (err instanceof AuditStorageError ? err.message : fallback);

function ToolRow({ title, children, action }: { title: string; children: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-ink">{title}</h3>
        <p className="mt-0.5 text-sm text-muted">{children}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

/** Backup, restore and delete for the saved reports, plus a storage check when reports are kept in an account. */
export function DataToolsCard() {
  const { state, refresh } = useAuditList();
  const [job, setJob] = useState<Job | null>(null);
  const [importNote, setImportNote] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [check, setCheck] = useState<StorageCheckStep[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Reports that can be read, and stored records that cannot. Both are removed by "Delete all reports".
  const count = state.status === "ready" ? state.list.total : null;
  const unreadable = state.status === "ready" ? state.list.unreadable : 0;
  const stored = count === null ? null : count + unreadable;
  const none = count === 0;

  async function exportAll(): Promise<void> {
    setJob("export");
    try {
      const audits = await auditRepo.exportAll();
      downloadTextFile(backupFileName(), buildBackup(audits), "application/json");
      toast.success(`A backup of ${plural(audits.length, "report")} is in your downloads.`);
    } catch (err) {
      toast.error(problem(err, "The backup could not be made. Try again."));
    } finally {
      setJob(null);
    }
  }

  async function importFile(file: File): Promise<void> {
    setImportNote(null);
    if (file.size > MAX_BACKUP_BYTES) {
      setImportNote({ tone: "error", text: `${file.name} is too large to be a ContractSoup backup.` });
      return;
    }
    setJob("import");
    try {
      const backup = parseBackup(await file.text());
      if (!backup.ok) {
        setImportNote({ tone: "error", text: backup.message });
        return;
      }
      const leftOut =
        backup.unreadable > 0
          ? ` ${plural(backup.unreadable, "entry", "entries")} in the file could not be read and ${backup.unreadable === 1 ? "was" : "were"} left out.`
          : "";
      if (backup.audits.length === 0) {
        setImportNote({ tone: "error", text: `No reports were found in ${file.name}.${leftOut}` });
        return;
      }
      const { added, alreadyThere } = await auditRepo.importMany(backup.audits);
      const already =
        alreadyThere > 0 ? ` ${plural(alreadyThere, "report")} ${alreadyThere === 1 ? "was" : "were"} already here and left as ${alreadyThere === 1 ? "it is" : "they are"}.` : "";
      setImportNote({
        tone: added > 0 ? "success" : "info",
        text: `${added > 0 ? `Added ${plural(added, "report")}.` : "Nothing new was added."}${already}${leftOut}`,
      });
    } catch (err) {
      setImportNote({ tone: "error", text: problem(err, "The backup could not be read. Try again.") });
    } finally {
      setJob(null);
      refresh();
    }
  }

  async function deleteAll(): Promise<void> {
    setJob("delete");
    try {
      const removed = await auditRepo.removeAll();
      setConfirmDelete(false);
      setImportNote(null);
      toast.success(`Deleted ${plural(removed, "report")}.`);
    } catch (err) {
      toast.error(problem(err, "The reports could not be deleted. Try again."));
    } finally {
      setJob(null);
      refresh();
    }
  }

  async function runCheck(): Promise<void> {
    setJob("check");
    setCheck(null);
    try {
      setCheck(await auditRepo.checkAccountStorage());
    } finally {
      setJob(null);
      refresh();
    }
  }

  return (
    <Card>
      <CardHeader
        title="Your reports"
        description={
          state.status === "ready"
            ? `${plural(state.list.total, "report")} ${state.list.total === 1 ? "is" : "are"} saved ${STORAGE_TEXT.savedIn}.`
            : state.status === "error"
              ? state.message
              : "Counting your saved reports."
        }
      />

      <div className="divide-y divide-line">
        <ToolRow
          title="Export a backup"
          action={
            <Button
              variant="secondary"
              icon={<Download className="h-4 w-4" />}
              loading={job === "export"}
              disabled={job !== null || none}
              onClick={() => void exportAll()}
            >
              Export all reports
            </Button>
          }
        >
          Saves every report to one file. The file holds what the reports show, not your contract or claims files.
        </ToolRow>

        <ToolRow
          title="Import a backup"
          action={
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                className="hidden"
                aria-label="Backup file to import"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = ""; // so choosing the same file again still counts as a change
                  if (file) void importFile(file);
                }}
              />
              <Button
                variant="secondary"
                icon={<Upload className="h-4 w-4" />}
                loading={job === "import"}
                disabled={job !== null}
                onClick={() => fileInput.current?.click()}
              >
                Import reports
              </Button>
            </>
          }
        >
          Adds the reports from a backup file. A report you already have is left as it is.
        </ToolRow>

        <ToolRow
          title="Delete all reports"
          action={
            <Button
              variant="secondary"
              icon={<Trash2 className="h-4 w-4" />}
              disabled={job !== null || !stored}
              onClick={() => setConfirmDelete(true)}
            >
              Delete all reports
            </Button>
          }
        >
          Removes every saved report {STORAGE_TEXT.removedFrom}. It cannot be undone.
        </ToolRow>
      </div>

      {importNote ? (
        <Notice tone={importNote.tone} role={importNote.tone === "error" ? "alert" : "status"} className="mt-4">
          {importNote.text}
        </Notice>
      ) : null}

      {STORAGE_PLACE === "account" ? (
        <div className="mt-5 border-t border-line pt-5">
          <h3 className="text-sm font-medium text-ink">Account storage check</h3>
          <p className="mt-0.5 max-w-2xl text-sm text-muted">
            Saves a small test report to your account, reads it back, checks that nobody else can read it, changes it
            and deletes it. Run it once when the site is first set up, and again if reports will not save or do not
            appear.
          </p>
          <Button
            variant="secondary"
            className="mt-3"
            loading={job === "check"}
            disabled={job !== null}
            onClick={() => void runCheck()}
          >
            Check account storage
          </Button>
          <div role="status">
            {check ? (
              <>
                <p className="mt-4 text-sm font-medium text-ink">
                  {check.every((step) => step.ok)
                    ? "Account storage is working."
                    : "Account storage is not working as it should."}
                </p>
                <ul className="mt-2 space-y-2">
                  {check.map((step) => (
                    <li key={step.name} className="flex items-start gap-2 text-sm">
                      {step.ok ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-high" aria-hidden="true" />
                      )}
                      <span className="min-w-0 break-words">
                        <span className="font-medium text-ink">
                          {step.ok ? "Passed" : "Failed"}: {step.name}.
                        </span>{" "}
                        <span className="text-muted">{step.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <Modal
        open={confirmDelete}
        onClose={job === "delete" ? () => undefined : () => setConfirmDelete(false)}
        title={stored === null ? "Delete all reports" : stored === 1 ? "Delete 1 report" : `Delete all ${plural(stored, "report")}`}
        description={`This removes every saved report ${STORAGE_TEXT.removedFrom}. It cannot be undone.`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" disabled={job === "delete"} data-autofocus onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={job === "delete"} onClick={() => void deleteAll()}>
              Delete all reports
            </Button>
          </>
        }
      >
        <p className="text-muted">
          Export a backup first if you may need them again.
          {unreadable > 0
            ? ` The count includes ${plural(unreadable, "saved report")} that could not be read and ${unreadable === 1 ? "is" : "are"} not part of a backup.`
            : ""}
        </p>
      </Modal>
    </Card>
  );
}
