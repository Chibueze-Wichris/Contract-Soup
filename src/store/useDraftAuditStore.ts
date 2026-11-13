import { create } from "zustand";
import { getAnalyzer, type Audit, type ContractTerm } from "@/analyzer";
import { categoryLabel } from "@/analyzer/categories";
import { summarizeFindings } from "@/analyzer/summary";
import { toast } from "@/components/ui";
import { AuditStorageError, auditRepo, newAuditId } from "@/lib/auditRepo";
import {
  CsvCancelledError,
  CsvError,
  claimsToTable,
  emptyMapping,
  guessMapping,
  mapClaims,
  readCsvFile,
  validateCsvFile,
  type ClaimField,
  type ClaimsResult,
  type ColumnMapping,
  type CsvTable,
  type DateOrderSetting,
} from "@/lib/claimsCsv";
import { PdfExtractionError, extractPages, validatePdfFile } from "@/lib/pdf";
import { nextManualTermId } from "@/lib/terms";
import { useAuthStore } from "@/store/useAuthStore";
import { currentSettings } from "@/store/useSettingsStore";

/**
 * The audit being put together in the New Audit wizard.
 *
 * The draft lives in memory only, so it survives moving around the app but not
 * a reload. That is on purpose: page text and claim rows must never be written
 * to storage. Long jobs (reading the PDF, reading the CSV, running the audit)
 * are started here rather than in components, so they keep going when the user
 * visits another page.
 */

export type WizardStep = 1 | 2 | 3 | 4;

export interface ContractState {
  status: "empty" | "reading" | "ready" | "error";
  source: "upload" | "sample" | null;
  fileName: string;
  /** Size in bytes. Null for the built-in sample. */
  fileSize: number | null;
  pageCount: number;
  /** While reading: opening the file, reading its pages, then picking out the terms. */
  stage: "opening" | "pages" | "terms";
  pagesDone: number;
  pagesTotal: number;
  error: string | null;
}

export interface ClaimsState {
  status: "empty" | "reading" | "ready" | "error";
  source: "upload" | "sample" | null;
  fileName: string;
  /** Size in bytes. Null for the built-in sample. */
  fileSize: number | null;
  /** While reading: a fraction from 0 to 1. */
  progress: number;
  error: string | null;
  /** The parsed file. Kept in memory only and dropped as soon as the audit is saved. */
  table: CsvTable | null;
  mapping: ColumnMapping;
  /** What the automatic guess chose, so the user can go back to it. */
  suggested: ColumnMapping;
  dateOrder: DateOrderSetting;
  /** The rows turned into claims with the current column choices. Null until a file is ready. */
  result: ClaimsResult | null;
}

export const RUN_PHASES = ["Reading terms", "Checking claims", "Ranking findings"] as const;

export interface RunState {
  status: "idle" | "running" | "error";
  /** Index into RUN_PHASES. */
  phase: number;
  error: string | null;
  /** The technical message behind the error, when there is one. */
  errorDetail: string | null;
}

export type TermPatch = Partial<Pick<ContractTerm, "label" | "value" | "unit" | "pageRef" | "snippet" | "confirmed">>;

export interface NewTermInput {
  category: string;
  label: string;
  value: ContractTerm["value"];
  unit: string;
  pageRef: number;
  /** The clause wording, if the user pasted it. */
  snippet: string;
}

interface DraftFields {
  step: WizardStep;
  /** The furthest step reached, so the stepper can jump between visited steps. */
  furthest: WizardStep;
  contract: ContractState;
  terms: ContractTerm[];
  claims: ClaimsState;
  auditName: string;
  run: RunState;
}

interface DraftAuditState extends DraftFields {
  /** Set when a run has been saved and its report has not been opened yet. */
  finishedAuditId: string | null;
  /** True while the New Audit page is on screen. */
  wizardOpen: boolean;

  setWizardOpen: (open: boolean) => void;
  goToStep: (step: WizardStep) => void;
  nextStep: () => void;
  previousStep: () => void;

  loadContract: (file: File) => Promise<void>;
  loadSample: () => Promise<void>;
  cancelContract: () => void;
  /** Removes the contract and its terms. A claims file the user uploaded is kept. */
  removeContract: () => void;

  updateTerm: (id: string, patch: TermPatch) => void;
  setTermsConfirmed: (ids: readonly string[], confirmed: boolean) => void;
  /** Adds a term typed in by the user and returns its id. Terms added this way start confirmed. */
  addTerm: (input: NewTermInput) => string;
  removeTerm: (id: string) => void;

  loadClaims: (file: File) => Promise<void>;
  /** Removes the claims file, or stops reading it. */
  removeClaims: () => void;
  setClaimColumn: (field: ClaimField, column: number | null) => void;
  restoreSuggestedColumns: () => void;
  setDateOrder: (setting: DateOrderSetting) => void;

  setAuditName: (name: string) => void;
  runAudit: () => Promise<void>;
  clearFinished: () => void;
  /** Throws the draft away and stops anything still running. */
  reset: () => void;
}

const SAMPLE_CLAIMS_FILE_NAME = "Harborview-claims-2025-SAMPLE.csv";
/** Each run phase stays on screen at least this long, so the progress can be read. */
const MIN_PHASE_MS = 450;

const EMPTY_CONTRACT: ContractState = {
  status: "empty",
  source: null,
  fileName: "",
  fileSize: null,
  pageCount: 0,
  stage: "opening",
  pagesDone: 0,
  pagesTotal: 0,
  error: null,
};

const IDLE_RUN: RunState = { status: "idle", phase: 0, error: null, errorDetail: null };

function emptyClaims(): ClaimsState {
  return {
    status: "empty",
    source: null,
    fileName: "",
    fileSize: null,
    progress: 0,
    error: null,
    table: null,
    mapping: emptyMapping(),
    suggested: emptyMapping(),
    dateOrder: "auto",
    result: null,
  };
}

function emptyDraft(): DraftFields {
  return {
    step: 1,
    furthest: 1,
    contract: EMPTY_CONTRACT,
    terms: [],
    claims: emptyClaims(),
    auditName: "",
    run: IDLE_RUN,
  };
}

function claimsFromTable(table: CsvTable, file: Pick<ClaimsState, "source" | "fileName" | "fileSize">): ClaimsState {
  const { mapping } = guessMapping(table);
  return {
    ...emptyClaims(),
    ...file,
    status: "ready",
    progress: 1,
    table,
    mapping,
    suggested: { ...mapping },
    result: mapClaims(table, mapping, "auto"),
  };
}

/** A claims file the user uploaded outlives a change of contract. The sample's claims go with the sample. */
function claimsToKeep(claims: ClaimsState): ClaimsState {
  return claims.source === "upload" ? claims : emptyClaims();
}

// Each job gets a number. A job that finds a newer number has been replaced or cancelled and stops quietly.
let contractJob = 0;
let claimsJob = 0;
let runJob = 0;

/** Thrown from the page-progress callback to stop pdf.js when a read has been cancelled. */
class Superseded extends Error {}

const pause = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return /dynamically imported module|importing a module script failed|failed to fetch/i.test(message);
}

/** "Harborview-PBM-Agreement.pdf" -> "Harborview PBM Agreement" */
export function defaultAuditName(fileName: string): string {
  const base = fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base || "Untitled audit";
}

/** True when the claims step holds nothing that blocks a run: no file, or a file whose rows are usable. */
export function claimsAreUsable(claims: ClaimsState): boolean {
  if (claims.status === "reading") return false;
  return claims.status !== "ready" || claims.result?.ok === true;
}

/** Whether the stepper may jump to a step right now. */
export function canOpenStep(state: Pick<DraftFields, "furthest" | "contract" | "claims" | "run">, step: WizardStep): boolean {
  if (state.run.status === "running") return false;
  if (step === 1) return true;
  if (step > state.furthest || state.contract.status !== "ready") return false;
  return step < 4 || claimsAreUsable(state.claims);
}

/** True when nothing has been added yet, so there is nothing to start over from. */
export function isDraftEmpty(state: Pick<DraftFields, "contract" | "claims">): boolean {
  return state.contract.status === "empty" && state.claims.status === "empty";
}

export const useDraftAuditStore = create<DraftAuditState>()((set, get) => ({
  ...emptyDraft(),
  finishedAuditId: null,
  wizardOpen: false,

  setWizardOpen: (open) => set({ wizardOpen: open }),

  goToStep: (step) => {
    if (canOpenStep(get(), step)) set({ step });
  },

  nextStep: () => {
    const s = get();
    if (s.step === 4 || s.run.status === "running" || s.contract.status !== "ready") return;
    if (s.step === 3 && !claimsAreUsable(s.claims)) return;
    const step = (s.step + 1) as WizardStep;
    set({
      step,
      furthest: Math.max(s.furthest, step) as WizardStep,
      // Moving on from a claims file that could not be read means carrying on without one.
      ...(s.step === 3 && s.claims.status === "error" ? { claims: emptyClaims() } : {}),
    });
  },

  previousStep: () => {
    const s = get();
    if (s.step === 1 || s.run.status === "running") return;
    set({ step: (s.step - 1) as WizardStep });
  },

  loadContract: async (file) => {
    if (get().run.status === "running") return;
    const invalid = validatePdfFile(file);
    if (invalid) {
      set({ contract: { ...EMPTY_CONTRACT, status: "error", fileName: file.name, error: invalid } });
      return;
    }

    const job = ++contractJob;
    const reading: ContractState = {
      ...EMPTY_CONTRACT,
      status: "reading",
      source: "upload",
      fileName: file.name,
      fileSize: file.size,
    };
    set({ ...emptyDraft(), contract: reading, claims: claimsToKeep(get().claims) });

    try {
      const pages = await extractPages(file, (done, total) => {
        if (job !== contractJob) throw new Superseded();
        set({ contract: { ...reading, stage: "pages", pagesDone: done, pagesTotal: total } });
      });
      if (job !== contractJob) return;

      set({ contract: { ...reading, stage: "terms", pagesDone: pages.length, pagesTotal: pages.length } });
      await pause(0); // let "Finding contract terms" paint before the rules run
      let terms: ContractTerm[];
      try {
        terms = await getAnalyzer().extractTerms(pages);
      } catch (err) {
        if (job !== contractJob) return;
        console.error("ContractSoup could not extract terms", err);
        set({
          contract: {
            ...EMPTY_CONTRACT,
            status: "error",
            fileName: file.name,
            error: "The PDF was read, but its terms could not be picked out. Try again.",
          },
        });
        return;
      }
      if (job !== contractJob) return;

      // The page text is not kept: from here on only the extracted terms are needed.
      set({
        contract: { ...reading, status: "ready", pageCount: pages.length, pagesDone: pages.length, pagesTotal: pages.length },
        terms,
        auditName: defaultAuditName(file.name),
        step: 2,
        furthest: 2,
      });
      if (!get().wizardOpen) toast.success("Your contract has been read. Open New Audit to review its terms.");
    } catch (err) {
      if (err instanceof Superseded || job !== contractJob) return;
      let message = "We could not read this PDF. Try saving it again and re-uploading.";
      if (err instanceof PdfExtractionError) message = err.message;
      else if (isChunkLoadError(err)) message = "The PDF reader could not be loaded. Check your connection, reload the page and try again.";
      else console.error("ContractSoup could not read a PDF", err);
      set({ contract: { ...EMPTY_CONTRACT, status: "error", fileName: file.name, error: message } });
      if (!get().wizardOpen) toast.error("The contract could not be read. Open New Audit for details.");
    }
  },

  loadSample: async () => {
    if (get().run.status === "running") return;
    const job = ++contractJob;
    claimsJob += 1;
    set({ ...emptyDraft(), contract: { ...EMPTY_CONTRACT, status: "reading", source: "sample", stage: "terms" } });

    try {
      const sample = await import("@/data/sample");
      const extracted = await getAnalyzer().extractTerms(sample.SAMPLE_PAGES);
      if (job !== contractJob) return;

      set({
        contract: {
          ...EMPTY_CONTRACT,
          status: "ready",
          source: "sample",
          fileName: sample.SAMPLE_FILE_NAME,
          pageCount: sample.SAMPLE_PAGES.length,
        },
        // The sample is there to be explored, so its clear terms arrive confirmed. Real uploads never do.
        terms: extracted.map((t) => ({ ...t, confirmed: t.confidence !== "low" })),
        claims: claimsFromTable(claimsToTable(sample.generateSampleClaims()), {
          source: "sample",
          fileName: SAMPLE_CLAIMS_FILE_NAME,
          fileSize: null,
        }),
        auditName: defaultAuditName(sample.SAMPLE_FILE_NAME),
        step: 2,
        furthest: 2,
      });
    } catch (err) {
      if (job !== contractJob) return;
      console.error("ContractSoup could not load the sample", err);
      set({
        contract: {
          ...EMPTY_CONTRACT,
          status: "error",
          error: isChunkLoadError(err)
            ? "The sample could not be loaded. Check your connection, reload the page and try again."
            : "The sample could not be loaded. Try again.",
        },
      });
    }
  },

  cancelContract: () => {
    if (get().contract.status !== "reading") return;
    contractJob += 1;
    set({ contract: EMPTY_CONTRACT });
  },

  removeContract: () => {
    if (get().run.status === "running") return;
    contractJob += 1;
    set({ ...emptyDraft(), claims: claimsToKeep(get().claims) });
  },

  updateTerm: (id, patch) => set((s) => ({ terms: s.terms.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

  setTermsConfirmed: (ids, confirmed) => {
    const wanted = new Set(ids);
    set((s) => ({ terms: s.terms.map((t) => (wanted.has(t.id) && t.confirmed !== confirmed ? { ...t, confirmed } : t)) }));
  },

  addTerm: (input) => {
    const id = nextManualTermId(get().terms);
    const term: ContractTerm = {
      id,
      category: input.category,
      label: input.label.trim() || categoryLabel(input.category),
      value: input.value,
      unit: input.unit,
      pageRef: input.pageRef,
      snippet: input.snippet.trim(),
      confidence: "high",
      confirmed: true,
    };
    set((s) => ({ terms: [...s.terms, term] }));
    return id;
  },

  removeTerm: (id) => set((s) => ({ terms: s.terms.filter((t) => t.id !== id) })),

  loadClaims: async (file) => {
    if (get().run.status === "running") return;
    const invalid = validateCsvFile(file);
    if (invalid) {
      claimsJob += 1;
      set({ claims: { ...emptyClaims(), status: "error", fileName: file.name, error: invalid } });
      return;
    }

    const job = ++claimsJob;
    const about = { source: "upload" as const, fileName: file.name, fileSize: file.size };
    set({ claims: { ...emptyClaims(), ...about, status: "reading" } });

    try {
      const table = await readCsvFile(file, {
        isCancelled: () => job !== claimsJob,
        onProgress: (progress) => {
          if (job === claimsJob) set({ claims: { ...emptyClaims(), ...about, status: "reading", progress } });
        },
      });
      if (job !== claimsJob) return;
      set({ claims: claimsFromTable(table, about) });
    } catch (err) {
      if (err instanceof CsvCancelledError || job !== claimsJob) return;
      if (!(err instanceof CsvError)) console.error("ContractSoup could not read a CSV", err);
      set({
        claims: {
          ...emptyClaims(),
          status: "error",
          fileName: file.name,
          error: err instanceof CsvError ? err.message : "That file could not be read. Check that it is a CSV and try again.",
        },
      });
    }
  },

  removeClaims: () => {
    if (get().run.status === "running") return;
    claimsJob += 1;
    set({ claims: emptyClaims() });
  },

  setClaimColumn: (field, column) => {
    const { claims } = get();
    if (!claims.table) return;
    const mapping = { ...claims.mapping, [field]: column };
    set({ claims: { ...claims, mapping, result: mapClaims(claims.table, mapping, claims.dateOrder) } });
  },

  restoreSuggestedColumns: () => {
    const { claims } = get();
    if (!claims.table) return;
    const mapping = { ...claims.suggested };
    set({ claims: { ...claims, mapping, result: mapClaims(claims.table, mapping, claims.dateOrder) } });
  },

  setDateOrder: (setting) => {
    const { claims } = get();
    if (!claims.table) return;
    set({ claims: { ...claims, dateOrder: setting, result: mapClaims(claims.table, claims.mapping, setting) } });
  },

  setAuditName: (name) => set({ auditName: name }),

  runAudit: async () => {
    const start = get();
    if (start.run.status === "running" || start.contract.status !== "ready" || !claimsAreUsable(start.claims)) return;

    const job = ++runJob;
    const showPhase = (phase: number): void => set({ run: { status: "running", phase, error: null, errorDetail: null } });

    try {
      // 1. Reading terms: the reviewed terms, exactly as they stand in step 2.
      showPhase(0);
      const analyzer = getAnalyzer();
      const terms = start.terms.map((t) => ({ ...t, label: t.label.trim() || categoryLabel(t.category) }));
      const claims = start.claims.status === "ready" && start.claims.result ? start.claims.result.claims : [];
      await pause(MIN_PHASE_MS);
      if (job !== runJob) return;

      // 2. Checking claims. The pause comes first so the label is on screen before the work starts.
      showPhase(1);
      await pause(MIN_PHASE_MS);
      const findings = await analyzer.compare(terms, claims, currentSettings());
      if (job !== runJob) return;

      // 3. Ranking findings: compare() returns them ranked, so what is left is the totals and the save.
      showPhase(2);
      const audit: Audit = {
        id: newAuditId(),
        name: start.auditName.trim() || defaultAuditName(start.contract.fileName),
        createdAt: new Date().toISOString(),
        contractFileName: start.contract.fileName,
        pageCount: start.contract.pageCount,
        claimsCount: claims.length,
        terms,
        findings,
        summary: summarizeFindings(findings),
        analyzerVersion: analyzer.version,
      };
      // PRIVACY: only the audit (terms, findings, totals) is saved. The claim rows stay in memory and are dropped below.
      const [saved] = await Promise.all([auditRepo.save(audit), pause(MIN_PHASE_MS)]);
      if (job !== runJob) return;

      set({ ...emptyDraft(), finishedAuditId: saved.id });
      if (!get().wizardOpen) toast.success("Your audit is finished and saved. Open New Audit to see the report.");
    } catch (err) {
      if (job !== runJob) return;
      if (!(err instanceof AuditStorageError)) console.error("ContractSoup could not finish an audit", err);
      set({
        run: {
          status: "error",
          phase: get().run.phase,
          error:
            err instanceof AuditStorageError
              ? err.message
              : "The audit could not be completed. Your contract and claims are still loaded, so you can try again.",
          errorDetail: !(err instanceof AuditStorageError) && err instanceof Error && err.message ? err.message : null,
        },
      });
      if (!get().wizardOpen) toast.error("The audit could not be completed. Open New Audit for details.");
    }
  },

  clearFinished: () => set({ finishedAuditId: null }),

  reset: () => {
    contractJob += 1;
    claimsJob += 1;
    runJob += 1;
    set({ ...emptyDraft(), finishedAuditId: null });
  },
}));

// A draft belongs to whoever was signed in when it was started. Clear it when that person signs out or the account changes.
useAuthStore.subscribe((state, previous) => {
  const before = previous.user?.id ?? null;
  if (before !== null && before !== (state.user?.id ?? null)) useDraftAuditStore.getState().reset();
});

// Uploaded files are held in memory only, so a reload would lose them. Ask before the tab closes with one loaded.
const holdsUpload = (part: { source: "upload" | "sample" | null; status: string }): boolean =>
  part.source === "upload" && (part.status === "reading" || part.status === "ready");

const confirmLeaving = (event: BeforeUnloadEvent): void => {
  event.preventDefault();
  event.returnValue = true; // older browsers only show the prompt when this is set
};

let guarding = false;
useDraftAuditStore.subscribe((state) => {
  const needed = holdsUpload(state.contract) || holdsUpload(state.claims);
  if (needed === guarding) return;
  guarding = needed;
  if (needed) window.addEventListener("beforeunload", confirmLeaving);
  else window.removeEventListener("beforeunload", confirmLeaving);
});
