import { useCallback, useEffect, useRef, useState } from "react";
import type { Audit, Finding } from "@/analyzer";
import { summarizeFindings } from "@/analyzer/summary";
import { AuditStorageError, auditRepo } from "@/lib/auditRepo";
import { STORAGE_TEXT } from "@/lib/storageText";

export type AuditLoad =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "error"; message: string }
  | { status: "ready"; audit: Audit };

/** What a reviewer can change on a finding. An empty note removes the note. */
export type FindingPatch = Partial<Pick<Finding, "status" | "note">>;

export interface UseAudit {
  load: AuditLoad;
  /** Why the latest change could not be saved, or null when everything is saved. */
  saveError: string | null;
  /** Reads the audit from storage again. */
  reload: () => void;
  /** Changes a finding, recalculates the totals and saves the audit. */
  updateFinding: (findingId: string, patch: FindingPatch) => void;
  /** Writes the audit as it is shown now, after a save has failed. */
  retrySave: () => void;
}

function applyPatch(finding: Finding, patch: FindingPatch): Finding {
  const status = patch.status ?? finding.status;
  const note = patch.note === undefined ? finding.note : patch.note.trim() || undefined;
  if (status === finding.status && note === finding.note) return finding;
  const next: Finding = { ...finding, status };
  if (note === undefined) delete next.note;
  else next.note = note;
  return next;
}

/** Loads one saved audit and keeps it saved as its findings are reviewed. */
export function useAudit(id: string | undefined): UseAudit {
  const [load, setLoad] = useState<AuditLoad>({ status: "loading" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<Audit | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let current = true;
    latest.current = null;
    setSaveError(null);
    if (!id) {
      setLoad({ status: "missing" });
      return;
    }
    setLoad({ status: "loading" });
    auditRepo.get(id).then(
      (audit) => {
        if (!current) return;
        latest.current = audit;
        setLoad(audit ? { status: "ready", audit } : { status: "missing" });
      },
      (err: unknown) => {
        if (!current) return;
        setLoad({
          status: "error",
          message:
            err instanceof AuditStorageError ? err.message : "This report could not be opened. Reload the page to try again.",
        });
      },
    );
    return () => {
      current = false;
    };
  }, [id, attempt]);

  // Writes are queued so they reach storage in the order the changes were made. Only the findings are
  // written, so a rename made on another page in the meantime is not undone.
  const persist = useCallback((audit: Audit) => {
    queue.current = queue.current.then(async () => {
      try {
        await auditRepo.update(audit.id, { findings: audit.findings });
        if (latest.current === audit) setSaveError(null);
      } catch (err) {
        if (latest.current?.id !== audit.id) return;
        setSaveError(
          err instanceof AuditStorageError ? err.message : `The change could not be saved ${STORAGE_TEXT.savedTo}. Try again.`,
        );
      }
    });
  }, []);

  const updateFinding = useCallback(
    (findingId: string, patch: FindingPatch) => {
      const audit = latest.current;
      if (!audit) return;
      let changed = false;
      const findings = audit.findings.map((f) => {
        if (f.id !== findingId) return f;
        const next = applyPatch(f, patch);
        if (next !== f) changed = true;
        return next;
      });
      if (!changed) return;
      const next: Audit = { ...audit, findings, summary: summarizeFindings(findings) };
      latest.current = next;
      setLoad({ status: "ready", audit: next });
      persist(next);
    },
    [persist],
  );

  const retrySave = useCallback(() => {
    if (latest.current) persist(latest.current);
  }, [persist]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { load, saveError, reload, updateFinding, retrySave };
}
