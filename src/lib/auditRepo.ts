import type { Dexie as DexieDatabase, EntityTable } from "dexie";
import type { Audit } from "@/analyzer";

/**
 * Where finished audits are stored. Pages, stores and components call this
 * module only: nothing else may touch Dexie or Supabase directly.
 *
 * PHASE 2 (this file): save() and get(), kept on this device in IndexedDB.
 * PHASE 4 replaces the inside of this module: the Supabase "audits" table when
 * a user is signed in, Dexie as the fallback, plus list(), update(), remove(),
 * rename() and duplicate(). Callers of save() and get() do not change.
 *
 * PRIVACY: only derived results are stored (terms, findings, summary). Never
 * the PDF, the page text, the claim rows or member identifiers.
 */

type AuditTable = EntityTable<Audit, "id">;

const DB_NAME = "contractsoup";

/** Storage failed. The message is safe to show as is. */
export class AuditStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditStorageError";
  }
}

let tablePromise: Promise<AuditTable> | null = null;

/** Opens the database on first use, so Dexie stays out of the main bundle. */
function openTable(): Promise<AuditTable> {
  tablePromise ??= import("dexie")
    .then(({ default: Dexie }) => {
      const db = new Dexie(DB_NAME) as DexieDatabase & { audits: AuditTable };
      db.version(1).stores({ audits: "id, createdAt" });
      return db.audits;
    })
    .catch((err: unknown) => {
      tablePromise = null; // let the next call try again
      throw err;
    });
  return tablePromise;
}

/**
 * Copies only the fields an Audit is allowed to have. Anything else that may
 * have been attached to the object (page text, claim rows) is left behind.
 */
function toRecord(a: Audit): Audit {
  return {
    id: a.id,
    name: a.name,
    createdAt: a.createdAt,
    contractFileName: a.contractFileName,
    pageCount: a.pageCount,
    claimsCount: a.claimsCount,
    terms: a.terms.map((t) => ({
      id: t.id,
      category: t.category,
      label: t.label,
      value: t.value,
      unit: t.unit,
      pageRef: t.pageRef,
      snippet: t.snippet,
      confidence: t.confidence,
      confirmed: t.confirmed,
      ...(t.match !== undefined ? { match: t.match } : {}),
    })),
    findings: a.findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      type: f.type,
      title: f.title,
      explanation: f.explanation,
      estimatedImpactUSD: f.estimatedImpactUSD,
      evidence: f.evidence.map((e) => ({ page: e.page, snippet: e.snippet })),
      ...(f.calc !== undefined ? { calc: f.calc } : {}),
      status: f.status,
      ...(f.note !== undefined ? { note: f.note } : {}),
    })),
    summary: {
      exposureUSD: a.summary.exposureUSD,
      bySeverity: { ...a.summary.bySeverity },
      byType: { ...a.summary.byType },
    },
    analyzerVersion: a.analyzerVersion,
  };
}

/** A new audit id. A UUID, so the same id works as the primary key in Supabase later. */
export function newAuditId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID needs https or localhost. Elsewhere, build a version 4 UUID by hand.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const auditRepo = {
  /** Stores a finished audit (insert or overwrite) and returns the stored copy. */
  async save(audit: Audit): Promise<Audit> {
    const record = toRecord(audit);
    try {
      const table = await openTable();
      await table.put(record);
    } catch (err) {
      console.error("ContractSoup could not save an audit", err);
      throw new AuditStorageError(
        "The audit could not be saved on this device. Check that your browser allows this site to store data (private windows often block it), then try again.",
      );
    }
    return record;
  },

  /** Returns the audit, or null when nothing is stored under that id. */
  async get(id: string): Promise<Audit | null> {
    try {
      const table = await openTable();
      return (await table.get(id)) ?? null;
    } catch (err) {
      console.error("ContractSoup could not read an audit", err);
      throw new AuditStorageError(
        "Saved audits could not be read on this device. Check that your browser allows this site to store data, then reload the page.",
      );
    }
  },
};
