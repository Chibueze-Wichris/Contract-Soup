import type { PageText } from "@/analyzer/types";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export const MAX_PDF_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_PAGES = 600;
const BATCH_SIZE = 10;
const MIN_TOTAL_CHARS = 200;

export const SCANNED_PDF_MESSAGE =
  "This looks like a scanned PDF. Text extraction found little text. Try a text-based PDF.";

export class PdfExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfExtractionError";
  }
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

/** Loads pdf.js on first use, so it stays out of the main bundle. */
function loadPdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  });
  return pdfjsPromise;
}

/** Returns a friendly message if the file cannot be used, otherwise null. */
export function validatePdfFile(file: File): string | null {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return "Please choose a PDF file.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_PDF_BYTES) return "That PDF is larger than 100 MB. Try a smaller file.";
  return null;
}

const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Reads the text of every page in the browser. Pages are processed in batches of 10
 * with a pause between batches so the interface stays responsive.
 * onProgress receives (pages done, total pages).
 */
export async function extractPages(
  file: File,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<PageText[]> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());

  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;
  try {
    doc = await pdfjs.getDocument({ data }).promise;
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") {
      throw new PdfExtractionError("This PDF is password protected. Remove the password and try again.");
    }
    if (name === "InvalidPDFException") {
      throw new PdfExtractionError("That file does not look like a valid PDF.");
    }
    throw new PdfExtractionError("We could not read this PDF. Try saving it again and re-uploading.");
  }

  try {
    const total = doc.numPages;
    if (total > MAX_PDF_PAGES) {
      throw new PdfExtractionError(`This PDF has ${total} pages. The limit is ${MAX_PDF_PAGES}.`);
    }

    const pages: PageText[] = [];
    onProgress(0, total);
    for (let start = 1; start <= total; start += BATCH_SIZE) {
      const numbers = Array.from({ length: Math.min(BATCH_SIZE, total - start + 1) }, (_, i) => start + i);
      const batch = await Promise.all(
        numbers.map(async (n): Promise<PageText> => {
          const page = await doc.getPage(n);
          const content = await page.getTextContent();
          const text = content.items
            .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
            .join("")
            .replace(/[ \t]+/g, " ")
            .replace(/ ?\n ?/g, "\n")
            .trim();
          page.cleanup();
          return { page: n, text };
        }),
      );
      pages.push(...batch);
      onProgress(pages.length, total);
      await yieldToUi();
    }

    const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
    if (totalChars < MIN_TOTAL_CHARS) throw new PdfExtractionError(SCANNED_PDF_MESSAGE);
    return pages;
  } finally {
    void doc.destroy();
  }
}
