import type { Dexie as DexieDatabase, EntityTable } from "dexie";
import type { Audit, Finding } from "@/analyzer";
import { summarizeFindings } from "@/analyzer/summary";
import {
  cleanAuditName,
  copyName,
  fromRow,
  isUuid,
  parseAudit,
  toListItem,
  toRecord,
  toRow,
  type AuditListItem,
} from "@/lib/auditRecord";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

/**
 * Where finished audits are stored. Pages, stores and components call this
 * module only: nothing else may touch Dexie or Supabase directly.
 *
 * There are two places, and a build uses exactly one of them:
 *  - "account": the Supabase "audits" table, when Supabase is set up. Every row
 *    belongs to the signed-in user (user_id), and row-level security in the
 *    database is what keeps other people's rows out of reach.
 *  - "device": IndexedDB (through Dexie), when Supabase is not set up.
 *
 * PRIVACY: only derived results are stored (terms, findings, summary). Never
 * the PDF, the page text, the claim rows or member identifiers.
 */

export type StoragePlace = "device" | "account";

/** Where this build keeps finished audits. */
export const STORAGE_PLACE: StoragePlace = isSupabaseConfigured ? "account" : "device";

export type StorageProblem = "blocked" | "unreachable" | "signed-out" | "refused" | "not-set-up" | "gone" | "unknown";

/** Storage failed. The message is safe to show as is; `detail` is the technical reason, when there is one. */
export class AuditStorageError extends Error {
  readonly problem: StorageProblem;
  readonly detail?: string;

  constructor(message: string, problem: StorageProblem = "unknown", detail?: string) {
    super(message);
    this.name = "AuditStorageError";
    this.problem = problem;
    this.detail = detail;
  }
}

/** What can be changed on a saved audit. The totals follow the findings, so they are never passed in. */
export interface AuditChanges {
  name?: string;
  findings?: Finding[];
}

export interface AuditList {
  /** Newest first. */
  items: AuditListItem[];
  /** How many audits are stored, not counting unreadable ones. More than `items.length` when the list was cut at LIST_LIMIT. */
  total: number;
  /** Stored records that do not have the shape of an audit. They are left out of `items` and of `total`. */
  unreadable: number;
}

export interface StorageCheckStep {
  name: string;
  ok: boolean;
  detail: string;
}

/** Lists stop here. Far more than anyone is expected to keep, and it bounds what one page load fetches. */
export const LIST_LIMIT = 500;

type Doing = "save" | "read" | "change" | "delete";

interface Backend {
  list(): Promise<AuditList>;
  get(id: string): Promise<Audit | null>;
  /** Adds the audit unless one with the same id is already stored. Answers with the id it is stored under. */
  insert(audit: Audit): Promise<{ outcome: "added" | "exists"; id: string }>;
  /** Adds the audit, or overwrites the one with the same id. Answers with the id it is stored under. */
  put(audit: Audit): Promise<string>;
  /** False when no audit has that id any more. */
  update(id: string, columns: Partial<Pick<Audit, "name" | "findings" | "summary">>): Promise<boolean>;
  remove(id: string): Promise<void>;
  removeAll(): Promise<number>;
  all(): Promise<Audit[]>;
}

const present = <T>(value: T | null): value is T => value !== null;

// ---------------------------------------------------------------------------
// This device: IndexedDB through Dexie
// ---------------------------------------------------------------------------

type AuditTable = EntityTable<Audit, "id">;

const DB_NAME = "contractsoup";

type AuditDatabase = DexieDatabase & { audits: AuditTable };

let databasePromise: Promise<AuditDatabase> | null = null;

/** Opens the database on first use, so Dexie stays out of the main bundle. */
function openTable(): Promise<AuditTable> {
  databasePromise ??= import("dexie").then(({ default: Dexie }) => {
    const db = new Dexie(DB_NAME) as AuditDatabase;
    db.version(1).stores({ audits: "id, createdAt" });
    return db;
  });
  return databasePromise.then((db) => db.audits);
}

/** After a failure the database is closed and forgotten, so the next call starts from a clean one. */
function forgetDatabase(): void {
  const failed = databasePromise;
  databasePromise = null;
  failed?.then((db) => db.close()).catch(() => undefined);
}

const DEVICE_MESSAGES: Record<Doing, string> = {
  save: "The audit could not be saved on this device. Check that your browser allows this site to store data (private windows often block it), then try again.",
  read: "Saved audits could not be read on this device. Check that your browser allows this site to store data, then reload the page.",
  change:
    "The change could not be saved on this device. Check that your browser allows this site to store data, then try again.",
  delete: "The report could not be deleted from this device. Try again.",
};

async function onDevice<T>(doing: Doing, work: (table: AuditTable) => Promise<T>): Promise<T> {
  try {
    return await work(await openTable());
  } catch (err) {
    console.error(`ContractSoup could not ${doing} an audit on this device`, err);
    forgetDatabase();
    throw new AuditStorageError(DEVICE_MESSAGES[doing], "blocked", err instanceof Error ? err.message : undefined);
  }
}

const newestFirst = (table: AuditTable): Promise<Audit[]> => table.orderBy("createdAt").reverse().toArray();

const device: Backend = {
  list: () =>
    onDevice("read", async (table) => {
      const records = await newestFirst(table);
      const items = records.map(parseAudit).filter(present).map(toListItem);
      return { items, total: items.length, unreadable: records.length - items.length };
    }),
  get: (id) => onDevice("read", async (table) => parseAudit(await table.get(id))),
  insert: (audit) =>
    onDevice("save", async (table) => {
      if ((await table.get(audit.id)) !== undefined) return { outcome: "exists" as const, id: audit.id };
      await table.add(toRecord(audit));
      return { outcome: "added" as const, id: audit.id };
    }),
  put: (audit) =>
    onDevice("save", async (table) => {
      await table.put(toRecord(audit));
      return audit.id;
    }),
  update: (id, columns) =>
    onDevice("change", async (table) => {
      // update() also answers 0 when nothing differed, so look the record up before calling it gone.
      return (await table.update(id, columns)) > 0 || (await table.get(id)) !== undefined;
    }),
  remove: (id) =>
    onDevice("delete", async (table) => {
      await table.delete(id);
    }),
  removeAll: () =>
    onDevice("delete", async (table) => {
      const count = await table.count();
      await table.clear();
      return count;
    }),
  all: () => onDevice("read", async (table) => (await newestFirst(table)).map(parseAudit).filter(present)),
};

// ---------------------------------------------------------------------------
// The account: the Supabase "audits" table
// ---------------------------------------------------------------------------

const TABLE = "audits";
/** Lists leave the terms out: they are the bulk of a row and no list shows them. */
const LIST_COLUMNS = "id,name,created_at,contract_file_name,page_count,claims_count,findings,analyzer_version";
const FULL_COLUMNS = `${LIST_COLUMNS},terms`;
const PAGE_SIZE = 100;
const TIME_LIMIT_MS = 20_000;
/** How many audits from a backup are being added at any moment. */
const IMPORT_AT_ONCE = 4;

interface ServerError {
  message: string;
  code?: string;
  details?: string | null;
}

/** The signed-in user and the client to reach their rows with. */
function signedIn(): { client: NonNullable<typeof supabase>; userId: string } {
  const userId = useAuthStore.getState().user?.id;
  if (!supabase || !userId) {
    throw new AuditStorageError("You are signed out. Sign in again, then try once more.", "signed-out");
  }
  return { client: supabase, userId };
}

/** Gives up after a while, so a dead connection becomes a message and not an endless spinner. */
function limited<B extends { abortSignal(signal: AbortSignal): B }>(query: B): B {
  return typeof AbortSignal.timeout === "function" ? query.abortSignal(AbortSignal.timeout(TIME_LIMIT_MS)) : query;
}

const ACCOUNT_MESSAGES: Record<Doing, string> = {
  save: "The report could not be saved to your account. Try again.",
  read: "Your reports could not be read from your account. Try again.",
  change: "The change could not be saved to your account. Try again.",
  delete: "The report could not be deleted from your account. Try again.",
};

const REFUSED =
  "Your account's storage refused this. If you look after this site, check the row-level security policies on the audits table in Supabase.";

const OPEN_TO_VISITORS =
  "The test report could be read without signing in, so saved reports are not private: anyone who has this site's address can read them. Row-level security is off for the audits table. Turn it on by running supabase/audits.sql in the Supabase SQL editor, then run this check again.";

const OPEN_TO_ACCOUNTS =
  "Your account can read reports that belong to other people, so they can read yours. Run supabase/audits.sql in the Supabase SQL editor, then run this check again. If it still fails, a policy on the audits table lets every signed-in person read it: remove that policy in Supabase.";

function accountError(doing: Doing, error: ServerError, status: number): AuditStorageError {
  const code = error.code ?? "";
  const detail = [code && `[${code}]`, error.message, error.details].filter(Boolean).join(" ");
  console.error(`ContractSoup could not ${doing} an audit in the account`, error);

  if (status === 0 || /failed to fetch|networkerror|load failed|aborterror|timeouterror|timed out/i.test(error.message)) {
    return new AuditStorageError(UNREACHABLE, "unreachable", detail);
  }
  if (status === 401 || /^PGRST30[123]$/.test(code)) {
    return new AuditStorageError("Your sign-in has ended. Sign out, sign in again, then try once more.", "signed-out", detail);
  }
  if (["PGRST205", "PGRST204", "42P01", "42703"].includes(code) || status === 404) {
    return new AuditStorageError(
      "Saved reports are not set up for this site yet. If you look after this site, check that the audits table exists in Supabase with the expected columns.",
      "not-set-up",
      detail,
    );
  }
  if (code === "42501" || status === 403) return new AuditStorageError(REFUSED, "refused", detail);
  return new AuditStorageError(ACCOUNT_MESSAGES[doing], "unknown", detail);
}

/** True when the signed-in user can still see a row with that id. */
async function rowExists(id: string): Promise<boolean> {
  const { client, userId } = signedIn();
  const { data, error, status } = await limited(client.from(TABLE).select("id").eq("id", id).eq("user_id", userId).limit(1));
  if (error) throw accountError("read", error, status);
  return (data?.length ?? 0) > 0;
}

const UNREACHABLE = "Your account could not be reached. Check your internet connection, then try again.";

/**
 * Asks for one row the way a visitor without an account would: with the site's publishable key and no sign-in.
 * True when the row comes back, which means the database is not keeping reports private.
 */
async function readableWithoutSignIn(id: string): Promise<boolean> {
  const base = import.meta.env.VITE_SUPABASE_URL ?? "";
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  const address = `${base.replace(/\/+$/, "")}/rest/v1/${TABLE}?select=id&id=eq.${encodeURIComponent(id)}&limit=1`;
  // A visitor can present the key in two ways. Both are tried, so being turned away one way is not taken for privacy.
  const ways: Record<string, string>[] = [{ apikey: key }, { apikey: key, Authorization: `Bearer ${key}` }];
  for (const headers of ways) {
    let response: Response;
    try {
      response = await fetch(address, {
        headers: { ...headers, Accept: "application/json" },
        credentials: "omit",
        cache: "no-store",
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(TIME_LIMIT_MS) : undefined,
      });
    } catch (err) {
      throw new AuditStorageError(UNREACHABLE, "unreachable", err instanceof Error ? err.message : undefined);
    }
    if (response.status === 401 || response.status === 403) continue; // turned away outright
    if (!response.ok) throw new AuditStorageError("This could not be checked. Try again.", "unknown", `HTTP ${response.status}`);
    const rows: unknown = await response.json();
    if (Array.isArray(rows) && rows.length > 0) return true;
  }
  return false;
}

/** True when the signed-in user can see a row that belongs to someone else. Only asks whether one exists. */
async function othersRowsVisible(): Promise<boolean> {
  const { client, userId } = signedIn();
  const { data, error, status } = await limited(client.from(TABLE).select("id").neq("user_id", userId).limit(1));
  if (error) throw accountError("read", error, status);
  return (data?.length ?? 0) > 0;
}

/** The id a user's own copy of someone else's audit is stored under: always the same for the same pair. */
async function idForCopy(auditId: string, userId: string): Promise<string> {
  if (typeof crypto.subtle?.digest !== "function") return newAuditId(); // needs https or localhost
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}:${auditId}`)));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // marked the way name-based UUIDs are
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const account: Backend = {
  async list() {
    const { client, userId } = signedIn();
    const { data, error, status, count } = await limited(
      client
        .from(TABLE)
        .select(LIST_COLUMNS, { count: "exact" })
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT),
    );
    if (error) throw accountError("read", error, status);
    const rows: unknown[] = data ?? [];
    const items = rows.map(fromRow).filter(present).map(toListItem);
    const unreadable = rows.length - items.length;
    return { items, total: Math.max(count ?? 0, rows.length) - unreadable, unreadable };
  },

  async get(id) {
    if (!isUuid(id)) return null; // the id column only holds UUIDs, so nothing else can be stored
    const { client, userId } = signedIn();
    const { data, error, status } = await limited(
      client.from(TABLE).select(FULL_COLUMNS).eq("id", id).eq("user_id", userId),
    ).maybeSingle();
    if (error) throw accountError("read", error, status);
    return fromRow(data);
  },

  async insert(audit) {
    const { client, userId } = signedIn();
    const { error, status } = await limited(client.from(TABLE).insert(toRow(audit, userId)));
    if (!error) return { outcome: "added", id: audit.id };
    if (error.code !== "23505") throw accountError("save", error, status);
    // Unique violation: a row already has that id. If this user can see it, the audit is already stored.
    if (await rowExists(audit.id)) return { outcome: "exists", id: audit.id };
    // Otherwise the row is someone else's, which happens when a backup is shared between accounts.
    // The audit is kept under an id of its own, the same one every time, so a repeat import still adds it once.
    const copy: Audit = { ...audit, id: await idForCopy(audit.id, userId) };
    const second = await limited(client.from(TABLE).insert(toRow(copy, userId)));
    if (!second.error) return { outcome: "added", id: copy.id };
    if (second.error.code === "23505" && (await rowExists(copy.id))) return { outcome: "exists", id: copy.id };
    throw accountError("save", second.error, second.status);
  },

  async put(audit) {
    const stored = await account.insert(audit);
    if (stored.outcome === "added") return stored.id;
    // Already stored under that id: overwrite it.
    const { client, userId } = signedIn();
    const { id: _id, user_id: _owner, ...columns } = toRow(audit, userId);
    const { data, error, status } = await limited(
      client.from(TABLE).update(columns).eq("id", stored.id).eq("user_id", userId).select("id"),
    );
    if (error) throw accountError("save", error, status);
    if (!data?.length) throw new AuditStorageError(REFUSED, "refused", "The update matched no row.");
    return stored.id;
  },

  async update(id, columns) {
    const { client, userId } = signedIn();
    const { data, error, status } = await limited(
      client
        .from(TABLE)
        .update({ ...columns, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId)
        .select("id"),
    );
    if (error) throw accountError("change", error, status);
    if (data?.length) return true;
    // Nothing changed. Either the report is gone, or the access rules skipped it without saying so.
    if (await rowExists(id)) throw new AuditStorageError(REFUSED, "refused", "The update matched no row.");
    return false;
  },

  async remove(id) {
    const { client, userId } = signedIn();
    const { error, status, count } = await limited(
      client.from(TABLE).delete({ count: "exact" }).eq("id", id).eq("user_id", userId),
    );
    if (error) throw accountError("delete", error, status);
    // Access rules can skip a delete without an error. Saying "deleted" while the report is still stored would be worse than failing.
    if (count === 0 && (await rowExists(id))) throw new AuditStorageError(REFUSED, "refused", "The delete matched no row.");
  },

  async removeAll() {
    const { client, userId } = signedIn();
    const { error, status, count } = await limited(client.from(TABLE).delete({ count: "exact" }).eq("user_id", userId));
    if (error) throw accountError("delete", error, status);
    return count ?? 0;
  },

  async all() {
    const { client, userId } = signedIn();
    const audits: Audit[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error, status } = await limited(
        client
          .from(TABLE)
          .select(FULL_COLUMNS)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, from + PAGE_SIZE - 1),
      );
      if (error) throw accountError("read", error, status);
      const rows: unknown[] = data ?? [];
      audits.push(...rows.map(fromRow).filter(present));
      if (rows.length < PAGE_SIZE) return audits;
    }
  },
};

// ---------------------------------------------------------------------------
// The one door everything else uses
// ---------------------------------------------------------------------------

const store: Backend = STORAGE_PLACE === "account" ? account : device;

const GONE = "This report no longer exists. It may have been deleted in another tab.";

const EMPTY_AUDIT: Audit = {
  id: "",
  name: "",
  createdAt: "",
  contractFileName: "",
  pageCount: 0,
  claimsCount: 0,
  terms: [],
  findings: [],
  summary: summarizeFindings([]),
  analyzerVersion: "",
};

/** A new audit id. A UUID, because that is what the id column of the audits table holds. */
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
    return { ...record, id: await store.put(record) };
  },

  /** Returns the audit, or null when nothing is stored under that id. */
  get(id: string): Promise<Audit | null> {
    return store.get(id);
  },

  /** Every saved audit in its short form, newest first. */
  list(): Promise<AuditList> {
    return store.list();
  },

  /** Changes the name or the findings of a saved audit. The totals are worked out again from the findings. */
  async update(id: string, changes: AuditChanges): Promise<void> {
    const columns: Partial<Pick<Audit, "name" | "findings" | "summary">> = {};
    if (changes.name !== undefined) {
      const name = cleanAuditName(changes.name);
      if (!name) throw new AuditStorageError("Enter a name for the report.");
      columns.name = name;
    }
    if (changes.findings !== undefined) {
      const { findings } = toRecord({ ...EMPTY_AUDIT, findings: changes.findings });
      columns.findings = findings;
      columns.summary = summarizeFindings(findings);
    }
    if (Object.keys(columns).length === 0) return;
    if (!(await store.update(id, columns))) throw new AuditStorageError(GONE, "gone");
  },

  rename(id: string, name: string): Promise<void> {
    return auditRepo.update(id, { name });
  },

  /** Saves a copy under a new id, named "Copy of …" and dated now. The review state is copied too. */
  async duplicate(id: string): Promise<Audit> {
    const source = await store.get(id);
    if (!source) throw new AuditStorageError(GONE, "gone");
    const copy: Audit = { ...source, id: newAuditId(), name: copyName(source.name), createdAt: new Date().toISOString() };
    const stored = await store.insert(copy);
    return { ...copy, id: stored.id };
  },

  remove(id: string): Promise<void> {
    return store.remove(id);
  },

  /** Deletes every saved audit and returns how many there were. */
  removeAll(): Promise<number> {
    return store.removeAll();
  },

  /** Every saved audit in full, for a backup file. */
  exportAll(): Promise<Audit[]> {
    return store.all();
  },

  /** Adds audits from a backup. One whose id is already stored is left as it is. */
  async importMany(audits: readonly Audit[]): Promise<{ added: number; alreadyThere: number }> {
    let added = 0;
    let next = 0;
    let failed = false;
    // A few at a time: one by one is slow over a long connection, and all at once would flood it.
    const worker = async (): Promise<void> => {
      while (!failed && next < audits.length) {
        const audit = audits[next++];
        try {
          if ((await store.insert(audit)).outcome === "added") added += 1;
        } catch (err) {
          failed = true; // the other workers stop after the audit they are on
          throw err;
        }
      }
    };
    // Settled, not all(): nothing is still being added in the background once this answers or throws.
    const results = await Promise.allSettled(Array.from({ length: Math.min(IMPORT_AT_ONCE, audits.length) }, worker));
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
    return { added, alreadyThere: audits.length - added };
  },

  /**
   * Account builds only: how many reports sit in this browser from before sign-in was switched on.
   * They are not in anyone's account, so no list shows them until they are moved.
   */
  async deviceReportCount(): Promise<number> {
    if (STORAGE_PLACE !== "account") return 0;
    try {
      const { default: Dexie } = await import("dexie");
      if (!(await Dexie.exists(DB_NAME))) return 0;
      return (await device.all()).length;
    } catch {
      return 0; // storage is blocked, so there is nothing here to offer
    }
  },

  /** Account builds only: copies the reports in this browser into the signed-in account, then removes them here. */
  async moveDeviceReportsToAccount(): Promise<{ moved: number; alreadyThere: number }> {
    let moved = 0;
    let alreadyThere = 0;
    for (const audit of await device.all()) {
      const { outcome } = await account.insert(isUuid(audit.id) ? audit : { ...audit, id: newAuditId() });
      await device.remove(audit.id);
      if (outcome === "added") moved += 1;
      else alreadyThere += 1;
    }
    return { moved, alreadyThere };
  },

  /** Account builds only: deletes the reports in this browser without moving them. */
  removeDeviceReports(): Promise<number> {
    return device.removeAll();
  },

  /**
   * Account builds only: saves a small test report to the account, reads it back, checks that it is out of
   * other people's reach, changes it and deletes it, and says how each step went. Nothing is left behind
   * unless the delete itself fails.
   */
  async checkAccountStorage(): Promise<StorageCheckStep[]> {
    const steps: StorageCheckStep[] = [];
    const attempt = async (name: string, work: () => Promise<string>): Promise<boolean> => {
      try {
        steps.push({ name, ok: true, detail: await work() });
        return true;
      } catch (err) {
        const detail =
          err instanceof AuditStorageError ? [err.message, err.detail].filter(Boolean).join(" Details: ") : String(err);
        steps.push({ name, ok: false, detail });
        return false;
      }
    };

    const test: Audit = {
      ...EMPTY_AUDIT,
      id: newAuditId(),
      name: "ContractSoup storage check",
      createdAt: new Date().toISOString(),
      contractFileName: "storage-check.pdf",
      analyzerVersion: "storage-check",
    };

    if (!(await attempt("You are signed in", async () => (signedIn(), "Yes.")))) return steps;
    await attempt("Read your reports", async () => {
      const { total } = await account.list();
      return total === 1 ? "1 report found." : `${total} reports found.`;
    });
    if (!(await attempt("Save a test report", async () => (await account.insert(test), "Saved.")))) return steps;
    await attempt("Read it back", async () => {
      const back = await account.get(test.id);
      if (!back) throw new AuditStorageError("The test report was saved but could not be read back.", "refused");
      return "It came back as it was saved.";
    });
    // The two steps that matter most: saving and reading work just as well on a table that anyone can read.
    await attempt("Hide it from people who are not signed in", async () => {
      if (await readableWithoutSignIn(test.id)) throw new AuditStorageError(OPEN_TO_VISITORS, "refused");
      return "A request made without signing in got nothing back.";
    });
    await attempt("Keep other people's reports out of your reach", async () => {
      if (await othersRowsVisible()) throw new AuditStorageError(OPEN_TO_ACCOUNTS, "refused");
      return "Your account can see no report that belongs to someone else.";
    });
    await attempt("Change it", async () => {
      const changed = await account.update(test.id, { name: `${test.name} (changed)` });
      if (!changed) throw new AuditStorageError("The test report could not be changed.", "refused", "The update matched no row.");
      return "Renamed.";
    });
    const deleted = await attempt("Delete it", async () => {
      await account.remove(test.id);
      return "Deleted. Nothing was left behind.";
    });
    if (!deleted) {
      steps[steps.length - 1].detail += ` The test report may still be in your account. Its name starts with "${test.name}".`;
    }
    return steps;
  },
};
