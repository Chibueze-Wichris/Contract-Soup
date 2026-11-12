import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditListItem } from "@/lib/auditRecord";
import { AuditStorageError, auditRepo, type AuditList } from "@/lib/auditRepo";

export type AuditListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; list: AuditList };

export interface UseAuditList {
  state: AuditListState;
  /** Reads the list again, showing the loading state. For a "Try again" button. */
  reload: () => void;
  /** Reads the list again behind what is on screen. For after a change. */
  refresh: () => void;
  /** Changes the list on screen straight away, ahead of the next refresh. */
  change: (edit: (items: AuditListItem[]) => AuditListItem[]) => void;
}

/** The saved audits in their short form, for the dashboard, the saved reports table and Settings. */
export function useAuditList(): UseAuditList {
  const [state, setState] = useState<AuditListState>({ status: "loading" });
  const request = useRef(0);

  const read = useCallback((quiet: boolean) => {
    const mine = ++request.current;
    if (!quiet) setState({ status: "loading" });
    auditRepo.list().then(
      (list) => {
        if (mine === request.current) setState({ status: "ready", list });
      },
      (err: unknown) => {
        if (mine !== request.current) return;
        // A quiet refresh that fails keeps what is on screen: the change itself already went through.
        if (quiet) return;
        setState({
          status: "error",
          message: err instanceof AuditStorageError ? err.message : "Your reports could not be read. Try again.",
        });
      },
    );
  }, []);

  useEffect(() => {
    read(false);
    return () => {
      request.current += 1; // drop an answer that arrives after the page has gone
    };
  }, [read]);

  const reload = useCallback(() => read(false), [read]);
  const refresh = useCallback(() => read(true), [read]);
  const change = useCallback((edit: (items: AuditListItem[]) => AuditListItem[]) => {
    setState((current) => {
      if (current.status !== "ready") return current;
      const items = edit(current.list.items);
      const removed = current.list.items.length - items.length;
      return { status: "ready", list: { ...current.list, items, total: Math.max(items.length, current.list.total - removed) } };
    });
  }, []);

  return { state, reload, refresh, change };
}
