import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";
import type { Audit } from "@/analyzer";
import { categoryLabel, findingTypeLabel, isMoneyCategory } from "@/analyzer/categories";
import { geminiName, usedGemini } from "@/lib/analyzerText";
import {
  FINDING_STATUSES,
  SEVERITIES,
  countByStatus,
  evidenceSource,
  impactText,
  isAiFinding,
  severityLabel,
  sortFindings,
  statusLabel,
} from "@/lib/findings";
import { formatCount, formatDateTime, formatUsd, plural } from "@/lib/format";
import { DISCLAIMER } from "@/lib/nav";
import { describeTermValue, isAiTerm, termNotes, termTitle } from "@/lib/terms";

/**
 * The audit report as a PDF. It is built in the browser from the saved audit, so
 * nothing is sent anywhere. jsPDF and its table plugin are loaded on first use.
 *
 * When Gemini read the contract, the report says so on its first page, marks every
 * finding that came from that reading, and never prints a dollar figure for one.
 */

/** Printed under the disclaimer of a report whose contract was read by Gemini. */
export function aiDisclosure(audit: Audit): string {
  const observations = audit.findings.filter(isAiFinding).length;
  return [
    `The contract was read by ${geminiName(audit)}. The contract terms it found were confirmed by a person before the money checks used them.`,
    observations > 0
      ? `${plural(observations, "finding")} marked "AI reading" ${observations === 1 ? "is an observation" : "are observations"} Gemini made about the contract's wording. ${observations === 1 ? "It has" : "They have"} no dollar estimate and ${observations === 1 ? "is" : "are"} not part of the estimated exposure.`
      : "",
    "Everything Gemini reported quotes the contract, and each quotation was checked against the PDF. An AI reading can still be wrong or incomplete.",
  ]
    .filter(Boolean)
    .join(" ");
}

type AutoTable = (doc: jsPDF, options: UserOptions) => void;
type Rgb = [number, number, number];

const MARGIN = 48;
/** Room kept free above the bottom margin for the footer line. */
const FOOTER = 30;
const INK: Rgb = [18, 22, 28];
const MUTED: Rgb = [91, 100, 114];
const BRAND: Rgb = [15, 92, 77];
const LINE: Rgb = [211, 207, 197];
const NOTE_FILL: Rgb = [252, 241, 220];

/**
 * The fonts built into every PDF reader cover Western European characters only.
 * Other punctuation is swapped for a plain equivalent, and anything left over becomes "?".
 */
export function pdfText(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2192/g, "->")
    .replace(/\u2264/g, "<=")
    .replace(/\u2265/g, ">=")
    .replace(/\u2022/g, "\u00B7")
    .replace(/[\u00A0\u2000-\u200B\u202F]/g, " ")
    .replace(/[^\t\n\x20-\x7E\u00A1-\u00FF]/g, "?");
}

/** "Harborview 2025 check - audit report.pdf". Characters a file system may refuse are left out. */
export function reportFileName(auditName: string): string {
  const base = auditName
    .replace(/[^A-Za-z0-9 _.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return `${base || "Audit"} - audit report.pdf`;
}

interface WriteOptions {
  size?: number;
  style?: "normal" | "bold";
  color?: Rgb;
  indent?: number;
  /** Space left under the text. */
  gap?: number;
}

/** Lays the report out on US Letter pages. The caller passes in jsPDF and the table plugin. */
export function buildReportPdf(audit: Audit, JsPdf: typeof jsPDF, autoTable: AutoTable): jsPDF {
  const doc = new JsPdf({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const left = MARGIN;
  const right = pageWidth - MARGIN;
  const textWidth = right - left;
  const bottom = pageHeight - MARGIN - FOOTER;
  let y = MARGIN;

  doc.setProperties({ title: pdfText(`${audit.name} - audit report`), subject: DISCLAIMER, creator: "ContractSoup" });

  /** Starts a new page when fewer than `space` points are left on this one. */
  const ensure = (space: number): void => {
    if (y + space > bottom) {
      doc.addPage();
      y = MARGIN;
    }
  };

  /** Writes wrapped text at the current position and moves down past it. */
  const write = (text: string, { size = 10, style = "normal", color = INK, indent = 0, gap = 4 }: WriteOptions = {}): void => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lineHeight = size * 1.35;
    // Wrapped a little short of the margin: readers that substitute their own font draw some lines slightly wider.
    const lines = doc.splitTextToSize(pdfText(text), (textWidth - indent) * 0.97) as string[];
    for (const line of lines) {
      ensure(lineHeight);
      doc.text(line, left + indent, y, { baseline: "top" });
      y += lineHeight;
    }
    y += gap;
  };

  const heading = (text: string): void => {
    ensure(60);
    write(text, { size: 13, style: "bold", gap: 6 });
  };

  const label = (text: string): void => {
    ensure(34);
    write(text, { size: 9, style: "bold", color: MUTED, gap: 1 });
  };

  const tableDefaults: UserOptions = {
    margin: { top: MARGIN, left, right: MARGIN, bottom: MARGIN + FOOTER },
    styles: { font: "helvetica", fontSize: 9, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.5, overflow: "linebreak" },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: "bold", lineWidth: 0 },
    theme: "grid",
  };
  const afterTable = (): number => (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y;

  const findings = sortFindings(audit.findings, "severity");
  const counted = findings.filter((f) => f.status !== "dismissed");
  const byStatus = countByStatus(findings);
  const usedTerms = audit.terms.filter((t) => t.confirmed);
  const unusedTerms = audit.terms.filter((t) => !t.confirmed);
  const withGemini = usedGemini(audit);
  const anyAiTerms = audit.terms.some(isAiTerm);
  const observations = counted.filter(isAiFinding).length;
  const fromChecks = counted.length - observations;
  /** "AI reading: One-sided term" for what Gemini noticed, the plain type for a money check. */
  const typeText = (f: (typeof findings)[number]): string =>
    isAiFinding(f) ? `AI reading: ${findingTypeLabel(f.type)}` : findingTypeLabel(f.type);

  // ---- Title and disclaimer ----
  write("ContractSoup audit report", { size: 9, style: "bold", color: BRAND, gap: 3 });
  write(audit.name, { size: 18, style: "bold", gap: 2 });
  write(`Created ${formatDateTime(audit.createdAt)}`, { color: MUTED, gap: 12 });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const disclaimerLines = doc.splitTextToSize(DISCLAIMER, textWidth - 24) as string[];
  const boxHeight = disclaimerLines.length * 13.5 + 15;
  doc.setDrawColor(...LINE);
  doc.setFillColor(...NOTE_FILL);
  doc.roundedRect(left, y, textWidth, boxHeight, 5, 5, "FD");
  doc.setTextColor(...INK);
  disclaimerLines.forEach((line, i) => doc.text(line, left + 12, y + 9 + i * 13.5, { baseline: "top" }));
  y += boxHeight + 14;

  if (withGemini) {
    write(aiDisclosure(audit), { size: 9, color: MUTED, gap: 12 });
  }

  // ---- Facts ----
  autoTable(doc, {
    ...tableDefaults,
    startY: y,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 10, cellPadding: { top: 3, bottom: 3, left: 0, right: 8 }, textColor: INK },
    columnStyles: { 0: { cellWidth: 140, textColor: MUTED } },
    body: [
      ["Contract", `${pdfText(audit.contractFileName)} (${plural(audit.pageCount, "page")})`],
      ["Claims checked", audit.claimsCount > 0 ? formatCount(audit.claimsCount) : "None. The audit ran without a claims file."],
      ...(withGemini ? [["Contract read by", pdfText(`${geminiName(audit)}. Its terms were confirmed by a person.`)]] : []),
      [
        "Contract terms used",
        `${formatCount(usedTerms.length)} confirmed, of ${formatCount(audit.terms.length)} found in the contract` +
          (anyAiTerms ? `. The money checks used the ${plural(usedTerms.filter((t) => isMoneyCategory(t.category)).length, "financial term")} among them.` : ""),
      ],
      [
        "Estimated exposure",
        observations > 0
          ? `${formatUsd(audit.summary.exposureUSD)} from ${plural(fromChecks, "finding")} of the money checks`
          : `${formatUsd(audit.summary.exposureUSD)} across ${plural(counted.length, "finding")}`,
      ],
      ...(observations > 0
        ? [["AI reading", `${plural(observations, "observation")} about the wording. No dollar estimate, and not part of the exposure.`]]
        : []),
      ["Findings by severity", SEVERITIES.map((s) => `${s.label} ${audit.summary.bySeverity[s.value] ?? 0}`).join(", ")],
      ["Review status", FINDING_STATUSES.map((s) => `${s.label} ${byStatus[s.value]}`).join(", ")],
      ["Analyzer", pdfText(audit.analyzerVersion)],
    ],
  });
  y = afterTable() + 20;

  // ---- Findings at a glance ----
  heading("Findings");
  if (findings.length === 0) {
    write(
      audit.claimsCount > 0
        ? "No problems were found in the claims that were checked."
        : "No problems were found. Without a claims file, nothing that was charged could be checked.",
      { gap: 14 },
    );
  } else {
    autoTable(doc, {
      ...tableDefaults,
      startY: y,
      head: [["#", "Severity", "Type", "Finding", "Status", "Estimated impact"]],
      body: findings.map((f, i) => [
        String(i + 1),
        severityLabel(f.severity),
        pdfText(typeText(f)),
        pdfText(f.title),
        statusLabel(f.status),
        impactText(f),
      ]),
      columnStyles: {
        0: { cellWidth: 22, halign: "right" },
        1: { cellWidth: 54 },
        2: { cellWidth: 96 },
        4: { cellWidth: 68 },
        5: { cellWidth: 78, halign: "right" },
      },
    });
    y = afterTable() + 8;
    if (byStatus.dismissed > 0) {
      write("Dismissed findings are listed for the record. They are not counted in the estimated exposure.", { size: 9, color: MUTED });
    }
    y += 12;
  }

  // ---- Each finding in full ----
  findings.forEach((f, i) => {
    ensure(96);
    write(`${i + 1}. ${f.title}`, { size: 12, style: "bold", gap: 2 });
    const fromAi = isAiFinding(f);
    write(
      fromAi
        ? `${severityLabel(f.severity)} severity, as judged by Gemini${f.confidence ? ` with ${severityLabel(f.confidence).toLowerCase()} confidence` : ""} \u00B7 ${typeText(f)} \u00B7 ${statusLabel(f.status)} \u00B7 No dollar estimate`
        : `${severityLabel(f.severity)} severity \u00B7 ${typeText(f)} \u00B7 ${statusLabel(f.status)} \u00B7 Estimated impact: ${impactText(f)}`,
      { size: 9, color: MUTED, gap: 7 },
    );
    label(fromAi ? "What Gemini noticed" : "What was found");
    write(f.explanation, { gap: 7 });
    if (f.evidence.length > 0) {
      label(fromAi ? "Contract wording it rests on" : "Evidence");
      for (const e of f.evidence) write(`${evidenceSource(e.page)}: ${e.snippet}`, { size: 9, indent: 10, gap: 3 });
      y += 4;
    }
    const about = (f.relatedTermIds ?? []).flatMap((id) => audit.terms.filter((t) => t.id === id));
    if (about.length > 0) {
      label("Contract terms this is about");
      for (const t of about) {
        write(`${termTitle(t)}: ${describeTermValue(t)} (page ${t.pageRef}${t.confirmed ? "" : ", not confirmed"})`, { size: 9, indent: 10, gap: 1 });
      }
      y += 6;
    }
    if (f.calc) {
      label("How this was worked out");
      for (const line of f.calc.split("\n")) write(line, { size: 9, indent: 10, gap: 1 });
      y += 6;
    }
    if (f.note) {
      label("Reviewer's note");
      write(f.note, { gap: 7 });
    }
    y += 10;
  });

  // ---- Contract terms ----
  if (audit.terms.length > 0) {
    heading("Contract terms used");
    if (usedTerms.length > 0) {
      autoTable(doc, {
        ...tableDefaults,
        startY: y,
        head: [["Term", "Value", "Contract page"]],
        body: usedTerms.map((t) => [
          // For a term Gemini read: its kind, then what Gemini understood, each on a line of its own.
          pdfText(
            [
              isAiTerm(t) && categoryLabel(t.category) !== termTitle(t) ? `${termTitle(t)} (${categoryLabel(t.category)})` : termTitle(t),
              ...termNotes(t),
            ].join("\n"),
          ),
          pdfText(describeTermValue(t)),
          String(t.pageRef),
        ]),
        columnStyles: { 1: { cellWidth: 150 }, 2: { cellWidth: 80, halign: "right" } },
      });
      y = afterTable() + 8;
    } else {
      write("No terms were confirmed, so the claims were not checked against the contract.", { gap: 6 });
    }
    if (unusedTerms.length > 0) {
      write(`Found in the contract but not confirmed, so not used: ${unusedTerms.map((t) => termTitle(t)).join(", ")}.`, {
        size: 9,
        color: MUTED,
      });
    }
  }

  // ---- Footer on every page ----
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.5);
    doc.line(left, pageHeight - MARGIN - 10, right, pageHeight - MARGIN - 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(DISCLAIMER, left, pageHeight - MARGIN, { baseline: "top" });
    doc.text(`Page ${page} of ${pages}`, right, pageHeight - MARGIN, { baseline: "top", align: "right" });
  }
  return doc;
}

/** Builds the PDF and hands it to the browser as a download. */
export async function downloadReportPdf(audit: Audit): Promise<void> {
  const [{ jsPDF: JsPdf }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  buildReportPdf(audit, JsPdf, autoTable).save(reportFileName(audit.name));
}
