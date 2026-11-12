import type { Audit, ContractTerm, Finding } from "@/analyzer";
import { summarizeFindings } from "@/analyzer/summary";

/**
 * Shape checks and copies for saved audits. Pure functions: no storage is touched here.
 *
 * Everything that is read back (from this device, from the account, or from a backup
 * file) passes through parseAudit(), so a damaged or hand-edited record can never
 * reach the screens. Everything that is written passes through toRecord(), so only
 * the fields an Audit is allowed to have are ever stored.
 */

export const AUDIT_NAME_LIMIT = 120;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Trims a name, joins runs of spaces and cuts it to the limit. May return an empty string. */
export function cleanAuditName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, AUDIT_NAME_LIMIT).trim();
}

/** "Copy of Harborview 2025", cut to the name limit. */
export function copyName(name: string): string {
  return cleanAuditName(`Copy of ${name}`);
}

/**
 * Copies only the fields an Audit is allowed to have. Anything else that may
 * have been attached to the object (page text, claim rows) is left behind.
 */
export function toRecord(a: Audit): Audit {
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

// ---- Reading: nothing is trusted until it has the right shape ----

const SHORT_TEXT = 500;
const LONG_TEXT = 100_000;
const MAX_TERMS = 1_000;
const MAX_FINDINGS = 5_000;
const MAX_EVIDENCE = 1_000;

const LEVELS = ["high", "medium", "low"] as const;
const STATUSES = ["open", "confirmed", "dismissed", "legal_review"] as const;

type Loose = Record<string, unknown>;

const isObject = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1e9;
const isAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T => allowed.includes(v as T);

function parseTerm(v: unknown): ContractTerm | null {
  if (!isObject(v)) return null;
  const valueOk = v.value === null || isAmount(v.value) || isText(v.value, SHORT_TEXT);
  if (
    !isText(v.id, SHORT_TEXT) ||
    !isText(v.category, SHORT_TEXT) ||
    !isText(v.label, SHORT_TEXT) ||
    !valueOk ||
    !isText(v.unit, SHORT_TEXT) ||
    !isCount(v.pageRef) ||
    !isText(v.snippet, LONG_TEXT) ||
    !oneOf(v.confidence, LEVELS) ||
    typeof v.confirmed !== "boolean" ||
    !(v.match === undefined || isText(v.match, LONG_TEXT))
  ) {
    return null;
  }
  return {
    id: v.id,
    category: v.category,
    label: v.label,
    value: v.value as ContractTerm["value"],
    unit: v.unit,
    pageRef: v.pageRef,
    snippet: v.snippet,
    confidence: v.confidence,
    confirmed: v.confirmed,
    ...(v.match !== undefined ? { match: v.match } : {}),
  };
}

function parseFinding(v: unknown): Finding | null {
  if (!isObject(v)) return null;
  if (
    !isText(v.id, SHORT_TEXT) ||
    !oneOf(v.severity, LEVELS) ||
    !isText(v.type, SHORT_TEXT) ||
    !isText(v.title, LONG_TEXT) ||
    !isText(v.explanation, LONG_TEXT) ||
    !(v.estimatedImpactUSD === null || isAmount(v.estimatedImpactUSD)) ||
    !Array.isArray(v.evidence) ||
    v.evidence.length > MAX_EVIDENCE ||
    !(v.calc === undefined || isText(v.calc, LONG_TEXT)) ||
    !oneOf(v.status, STATUSES) ||
    !(v.note === undefined || isText(v.note, LONG_TEXT))
  ) {
    return null;
  }
  const evidence: Finding["evidence"] = [];
  for (const e of v.evidence as unknown[]) {
    if (!isObject(e) || !isCount(e.page) || !isText(e.snippet, LONG_TEXT)) return null;
    evidence.push({ page: e.page, snippet: e.snippet });
  }
  return {
    id: v.id,
    severity: v.severity,
    type: v.type,
    title: v.title,
    explanation: v.explanation,
    estimatedImpactUSD: v.estimatedImpactUSD as number | null,
    evidence,
    ...(v.calc !== undefined ? { calc: v.calc } : {}),
    status: v.status,
    ...(v.note !== undefined ? { note: v.note } : {}),
  };
}

function parseList<T>(v: unknown, max: number, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: T[] = [];
  for (const item of v) {
    const parsed = parse(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

/**
 * Returns a clean Audit, or null when the value does not have the shape of one.
 * The totals are always worked out again from the findings, so they cannot disagree with them.
 */
export function parseAudit(v: unknown): Audit | null {
  if (!isObject(v)) return null;
  const created = typeof v.createdAt === "string" ? Date.parse(v.createdAt) : Number.NaN;
  const terms = parseList(v.terms, MAX_TERMS, parseTerm);
  const findings = parseList(v.findings, MAX_FINDINGS, parseFinding);
  if (
    !isText(v.id, SHORT_TEXT) ||
    v.id === "" ||
    !isText(v.name, SHORT_TEXT) ||
    Number.isNaN(created) ||
    !isText(v.contractFileName, SHORT_TEXT) ||
    !isCount(v.pageCount) ||
    !isCount(v.claimsCount) ||
    terms === null ||
    findings === null ||
    !isText(v.analyzerVersion, SHORT_TEXT)
  ) {
    return null;
  }
  return {
    id: v.id,
    name: cleanAuditName(v.name) || "Untitled audit",
    createdAt: new Date(created).toISOString(),
    contractFileName: v.contractFileName,
    pageCount: v.pageCount,
    claimsCount: v.claimsCount,
    terms,
    findings,
    summary: summarizeFindings(findings),
    analyzerVersion: v.analyzerVersion,
  };
}

// ---- The short form used by lists ----

/** What the dashboard and the saved reports table need to know about an audit. */
export interface AuditListItem {
  id: string;
  name: string;
  createdAt: string;
  contractFileName: string;
  pageCount: number;
  claimsCount: number;
  /** Estimated exposure, leaving dismissed findings out. */
  exposureUSD: number;
  /** Every finding, dismissed ones included. */
  findingCount: number;
  /** Findings nobody has reviewed yet. */
  openCount: number;
}

export function toListItem(audit: Audit): AuditListItem {
  return {
    id: audit.id,
    name: audit.name,
    createdAt: audit.createdAt,
    contractFileName: audit.contractFileName,
    pageCount: audit.pageCount,
    claimsCount: audit.claimsCount,
    exposureUSD: audit.summary.exposureUSD,
    findingCount: audit.findings.length,
    openCount: audit.findings.filter((f) => f.status === "open").length,
  };
}

// ---- Account rows: the "audits" table uses snake_case column names ----

export interface AuditRow {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  contract_file_name: string;
  page_count: number;
  claims_count: number;
  terms: ContractTerm[];
  findings: Finding[];
  summary: Audit["summary"];
  analyzer_version: string;
}

export function toRow(audit: Audit, userId: string, now: Date = new Date()): AuditRow {
  const a = toRecord(audit);
  return {
    id: a.id,
    user_id: userId,
    name: a.name,
    created_at: a.createdAt,
    updated_at: now.toISOString(),
    contract_file_name: a.contractFileName,
    page_count: a.pageCount,
    claims_count: a.claimsCount,
    terms: a.terms,
    findings: a.findings,
    summary: a.summary,
    analyzer_version: a.analyzerVersion,
  };
}

/** Reads a row back. Lists leave the terms column out to stay small, so missing terms count as none. */
export function fromRow(row: unknown): Audit | null {
  if (!isObject(row)) return null;
  return parseAudit({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    contractFileName: row.contract_file_name,
    pageCount: row.page_count,
    claimsCount: row.claims_count,
    terms: row.terms ?? [],
    findings: row.findings,
    analyzerVersion: row.analyzer_version,
  });
}

// ---- Backup files ----

const BACKUP_APP = "ContractSoup";
const BACKUP_KIND = "reports-backup";
const BACKUP_VERSION = 1;

/** The text of a backup file holding these audits. */
export function buildBackup(audits: readonly Audit[], now: Date = new Date()): string {
  return JSON.stringify(
    { app: BACKUP_APP, kind: BACKUP_KIND, version: BACKUP_VERSION, exportedAt: now.toISOString(), audits: audits.map(toRecord) },
    null,
    1,
  );
}

/** "contractsoup-reports-2026-11-11.json", dated in the reader's own time zone. */
export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `contractsoup-reports-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

export type BackupResult =
  | { ok: true; audits: Audit[]; /** Entries that did not have the shape of a report. */ unreadable: number }
  | { ok: false; message: string };

/** Reads a backup file. Each report in it is checked, and the ones that cannot be read are counted, not kept. */
export function parseBackup(text: string): BackupResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: "That file could not be read. Choose a backup file exported from ContractSoup." };
  }
  if (!isObject(data) || data.app !== BACKUP_APP || data.kind !== BACKUP_KIND || !Array.isArray(data.audits)) {
    return { ok: false, message: "That file is not a ContractSoup backup. Choose a file exported from Settings." };
  }
  if (typeof data.version !== "number" || data.version > BACKUP_VERSION) {
    return { ok: false, message: "That backup was made by a newer version of ContractSoup, so it cannot be read here." };
  }
  const audits: Audit[] = [];
  const seen = new Set<string>();
  let unreadable = 0;
  for (const entry of data.audits as unknown[]) {
    const audit = parseAudit(entry);
    if (!audit || !isUuid(audit.id)) unreadable += 1;
    else if (!seen.has(audit.id)) {
      seen.add(audit.id);
      audits.push(audit);
    }
  }
  return { ok: true, audits, unreadable };
}
