import { create } from "zustand";
import { AiReaderError, createGeminiAnalyzer, getAnalyzer, type AiReadReport, type Analyzer, type Audit, type ContractTerm, type PageText } from "@/analyzer";
import { categoryLabel } from "@/analyzer/categories";
import { summarizeFindings } from "@/analyzer/summary";
import { toast } from "@/components/ui";
import { AI_READER_AVAILABLE, aiTransport } from "@/lib/aiReader";
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
 *
 * Who reads the contract is chosen for each audit: the built-in reader, which
 * works on this device, or the Gemini reader, which sends the contract's page
 * text to the project's Edge Function and needs the user's agreement each time.
 * When the Gemini reader fails, the draft says so and waits. It never switches
 * to the built-in reader by itself.
 */

export type WizardStep = 1 | 2 | 3 | 4;

/** "local": the built-in rules, on this device. "gemini": Google Gemini, through the Edge Function. */
export type ReaderKind = "local" | "gemini";

export interface ContractState {
  status: "empty" | "reading" | "ready" | "error";
  source: "upload" | "sample" | null;
  fileName: string;
  /** Size in bytes. Null for the built-in sample. */
  fileSize: number | null;
  pageCount: number;
  /** While reading: opening the file, reading its pages, then picking out the terms ("ai" when Gemini is doing that). */
  stage: "opening" | "pages" | "terms" | "ai";
  pagesDone: number;
  pagesTotal: number;
  error: string | null;
  /** Who is reading, or has read, this contract. */
  reader: ReaderKind;
  /**
   * Set when the Gemini reader could not read the contract. The page text is still in memory,
   * so the reading can be tried again or given to the built-in reader, whichever the user picks.
   */
  aiFailure: { code: string; retryable: boolean } | null;
  /** What the Gemini reader left out and added. Null for the built-in reader. */
  aiReport: AiReadReport | null;
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
  /** Who will read the next contract. The built-in reader unless the user picks Gemini. */
  reader: ReaderKind;
  /** The user's agreement to send this audit's contract text to Gemini. Asked again for every audit. */
  aiConsent: boolean;

  setWizardOpen: (open: boolean) => void;
  setReader: (reader: ReaderKind) => void;
  setAiConsent: (agreed: boolean) => void;
  goToStep: (step: WizardStep) => void;
  nextStep: () => void;
  previousStep: () => void;

  loadContract: (file: File) => Promise<void>;
  loadSample: () => Promise<void>;
  /** After the Gemini reader failed: asks it again, for the pages it has not read yet. */
  retryAiReading: () => Promise<void>;
  /** After the Gemini reader failed: reads the same pages with the built-in reader instead. Only ever called by the user. */
  switchToBuiltInReader: () => Promise<void>;
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
  reader: "local",
  aiFailure: null,
  aiReport: null,
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

// ---- Held in memory for the contract in the draft, and nowhere else ----

/** The analyzer that read the draft's terms. The run uses the same one, because the Gemini analyzer remembers what it noticed. */
let draftAnalyzer: Analyzer | null = null;

interface HeldReading {
  pages: PageText[];
  reading: ContractState;
  after: AfterReading;
  /** Kept so that trying again only asks for the pages Gemini has not read yet. */
  gemini: ReturnType<typeof createGeminiAnalyzer> | null;
}

/** The page text of a contract the Gemini reader is working on or has failed on. Dropped as soon as terms are ready. */
let heldReading: HeldReading | null = null;
/** Stops the request to the Gemini reader that is in flight, if there is one. */
let aiRequest: AbortController | null = null;

function dropContractMemory(): void {
  aiRequest?.abort();
  aiRequest = null;
  heldReading = null;
  draftAnalyzer = null;
}

/** What to fill in once the terms have been read. */
interface AfterReading {
  auditName: string;
  /** The sample brings its own claims. */
  claims?: ClaimsState;
}

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

  reader: "local",
  aiConsent: false,

  setWizardOpen: (open) => set({ wizardOpen: open }),

  setReader: (reader) => {
    if (get().contract.status === "reading" || get().run.status === "running") return;
    // Agreement is given for one choice of the Gemini reader. Picking it again means agreeing again.
    set({ reader: AI_READER_AVAILABLE ? reader : "local", aiConsent: false });
  },

  setAiConsent: (agreed) => set({ aiConsent: agreed }),

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
    const reader = chosenReader(get());
    if (reader === null) {
      set({ contract: { ...EMPTY_CONTRACT, status: "error", fileName: file.name, error: CONSENT_NEEDED } });
      return;
    }

    const job = ++contractJob;
    dropContractMemory();
    const reading: ContractState = {
      ...EMPTY_CONTRACT,
      status: "reading",
      source: "upload",
      fileName: file.name,
      fileSize: file.size,
      reader,
    };
    set({ ...emptyDraft(), contract: reading, claims: claimsToKeep(get().claims) });

    try {
      // The PDF is always read here, in the browser. Only its text can go on to the Gemini reader.
      const pages = await extractPages(file, (done, total) => {
        if (job !== contractJob) throw new Superseded();
        set({ contract: { ...reading, stage: "pages", pagesDone: done, pagesTotal: total } });
      });
      if (job !== contractJob) return;
      await readTerms(job, pages, reading, { auditName: defaultAuditName(file.name) });
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
    const reader = chosenReader(get());
    if (reader === null) {
      set({ contract: { ...EMPTY_CONTRACT, status: "error", error: CONSENT_NEEDED } });
      return;
    }
    const job = ++contractJob;
    claimsJob += 1;
    dropContractMemory();
    const loading: ContractState = { ...EMPTY_CONTRACT, status: "reading", source: "sample", stage: "terms", reader };
    set({ ...emptyDraft(), contract: loading });

    try {
      const sample = await import("@/data/sample");
      if (job !== contractJob) return;
      await readTerms(
        job,
        sample.SAMPLE_PAGES,
        { ...loading, fileName: sample.SAMPLE_FILE_NAME },
        {
          auditName: defaultAuditName(sample.SAMPLE_FILE_NAME),
          claims: claimsFromTable(claimsToTable(sample.generateSampleClaims()), {
            source: "sample",
            fileName: SAMPLE_CLAIMS_FILE_NAME,
            fileSize: null,
          }),
        },
      );
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

  retryAiReading: async () => {
    const held = heldReading;
    if (!held || get().contract.aiFailure === null || get().run.status === "running") return;
    // The agreement can have been withdrawn since the failure, by unticking the box or choosing the other reader.
    if (chosenReader(get()) !== "gemini") return;
    const job = ++contractJob;
    await readTerms(job, held.pages, { ...held.reading, reader: "gemini" }, held.after, held.gemini);
  },

  switchToBuiltInReader: async () => {
    const held = heldReading;
    if (!held || get().contract.aiFailure === null || get().run.status === "running") return;
    const job = ++contractJob;
    // The user asked for this. The contract is read again by the built-in rules, and nothing more is sent anywhere.
    set({ reader: "local", aiConsent: false });
    await readTerms(job, held.pages, { ...held.reading, reader: "local" }, held.after);
  },

  cancelContract: () => {
    if (get().contract.status !== "reading") return;
    contractJob += 1;
    dropContractMemory();
    // Stopping a reading also withdraws the agreement to send, so the next file is not sent on the strength of it.
    set({ contract: EMPTY_CONTRACT, aiConsent: false });
  },

  removeContract: () => {
    if (get().run.status === "running") return;
    contractJob += 1;
    dropContractMemory();
    set({ ...emptyDraft(), claims: claimsToKeep(get().claims), aiConsent: false });
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
      // The analyzer that read this contract. For the Gemini reader it also holds what Gemini noticed in the wording.
      const analyzer = draftAnalyzer ?? getAnalyzer();
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

      dropContractMemory();
      set({ ...emptyDraft(), finishedAuditId: saved.id, aiConsent: false });
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
    dropContractMemory();
    set({ ...emptyDraft(), finishedAuditId: null, aiConsent: false });
  },
}));

const CONSENT_NEEDED = "Tick the box to agree to send this contract's text to Google Gemini, or choose the built-in reader.";

/** The reader to use for a new contract, or null when Gemini is chosen but has not been agreed to. */
function chosenReader(state: Pick<DraftAuditState, "reader" | "aiConsent">): ReaderKind | null {
  if (!AI_READER_AVAILABLE || state.reader !== "gemini") return "local";
  return state.aiConsent ? "gemini" : null;
}

/**
 * Picks the terms out of page text with the reader named in `reading`, then fills in the draft.
 * Used for a first reading, for another try with Gemini, and for the user's switch to the built-in reader.
 */
async function readTerms(
  job: number,
  pages: PageText[],
  reading: ContractState,
  after: AfterReading,
  earlier: HeldReading["gemini"] = null,
): Promise<void> {
  const { getState: get, setState: set } = useDraftAuditStore;
  const withGemini = reading.reader === "gemini";
  const total = pages.length;
  const working: ContractState = {
    ...reading,
    status: "reading",
    stage: withGemini ? "ai" : "terms",
    pagesDone: withGemini ? 0 : total,
    pagesTotal: total,
    error: null,
    aiFailure: null,
    aiReport: null,
  };
  aiRequest?.abort();
  aiRequest = null;
  draftAnalyzer = null;
  set({ contract: working });
  await pause(0); // let the progress line paint before the work starts
  if (job !== contractJob) return;

  let terms: ContractTerm[];
  let analyzer: Analyzer;
  let aiReport: AiReadReport | null = null;
  try {
    if (withGemini) {
      const gemini = earlier ?? createGeminiAnalyzer(aiTransport);
      // The page text is held until Gemini has finished, so a failure can be retried without reading the PDF again.
      heldReading = { pages, reading, after, gemini };
      const request = new AbortController();
      aiRequest = request;
      terms = await gemini.extractTerms(pages, {
        signal: request.signal,
        onProgress: ({ pagesDone, pagesTotal }) => {
          if (job === contractJob) set({ contract: { ...working, pagesDone, pagesTotal } });
        },
      });
      analyzer = gemini;
      aiReport = gemini.report;
    } else {
      heldReading = null;
      analyzer = getAnalyzer();
      terms = await analyzer.extractTerms(pages);
    }
  } catch (err) {
    if (job !== contractJob) return;
    aiRequest = null;
    if (err instanceof AiReaderError) {
      // No silent switch: the draft stops here and says why. The user chooses what happens next.
      set({
        contract: {
          ...EMPTY_CONTRACT,
          status: "error",
          fileName: reading.fileName,
          reader: "gemini",
          error: err.message,
          aiFailure: { code: err.code, retryable: err.retryable },
        },
      });
      if (!get().wizardOpen) toast.error("Gemini could not read the contract. Open New Audit to choose what to do.");
      return;
    }
    console.error("ContractSoup could not extract terms", err);
    heldReading = null;
    set({
      contract: {
        ...EMPTY_CONTRACT,
        status: "error",
        fileName: reading.fileName,
        error: "The contract was read, but its terms could not be picked out. Try again.",
      },
    });
    return;
  }
  if (job !== contractJob) return;

  // The page text is not kept: from here on only the extracted terms are needed.
  heldReading = null;
  aiRequest = null;
  draftAnalyzer = analyzer;
  // The sample is there to be explored, so the built-in reader's clear terms arrive confirmed.
  // Real uploads never do, and neither does anything Gemini read: a person confirms those, every time.
  const confirmClearOnes = reading.source === "sample" && !withGemini;
  set({
    contract: { ...working, status: "ready", pageCount: total, pagesDone: total, pagesTotal: total, aiReport },
    terms: confirmClearOnes ? terms.map((t) => ({ ...t, confirmed: t.confidence !== "low" })) : terms,
    ...(after.claims ? { claims: after.claims } : {}),
    auditName: after.auditName,
    step: 2,
    furthest: 2,
  });
  if (!get().wizardOpen && reading.source === "upload") toast.success("Your contract has been read. Open New Audit to review its terms.");
}

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
