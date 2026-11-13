import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, FileText, Table2 } from "lucide-react";
import type { ContractTerm, Finding } from "@/analyzer";
import { findingTypeLabel } from "@/analyzer/categories";
import { AiBadge, Badge, Button, Drawer, NeedsReviewBadge, Notice, SeverityBadge, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { FINDING_STATUSES, awaitsReview, evidenceSource, impactText, isAiFinding, severityLabel } from "@/lib/findings";
import { describeTermValue, termTitle } from "@/lib/terms";
import { STORAGE_TEXT } from "@/lib/storageText";
import type { FindingPatch } from "@/lib/useAudit";
import { StatusBadge } from "./StatusBadge";

/** The finding being shown, and the order Previous and Next walk through (the list as it was when the panel opened). */
export interface OpenFinding {
  id: string;
  order: readonly string[];
}

interface FindingDrawerProps {
  /** Every finding of the audit. */
  findings: readonly Finding[];
  /** The audit's contract terms, so an observation can name the ones it is about. */
  terms: readonly ContractTerm[];
  open: OpenFinding | null;
  onNavigate: (findingId: string) => void;
  onClose: () => void;
  onUpdate: (findingId: string, patch: FindingPatch) => void;
  /** Why the latest change could not be saved, or null when everything is saved. */
  saveError: string | null;
  onRetrySave: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const NOTE_LIMIT = 2000;

/** The reviewer's note. It is saved a moment after typing stops, when the field is left, and when the panel moves on. */
function NoteField({ finding, onSave }: { finding: Finding; onSave: (note: string) => void }) {
  const [text, setText] = useState(finding.note ?? "");
  const typed = useRef(text);
  const saved = useRef((finding.note ?? "").trim());
  const save = useRef(onSave);
  save.current = onSave;

  const commit = useRef(() => {
    const note = typed.current.trim();
    if (note === saved.current) return;
    saved.current = note;
    save.current(note);
  }).current;

  useEffect(() => {
    const timer = window.setTimeout(commit, 700);
    return () => window.clearTimeout(timer);
  }, [text, commit]);
  useEffect(() => commit, [commit]); // on the way out, so nothing typed is lost

  return (
    <Textarea
      label="Note"
      rows={3}
      maxLength={NOTE_LIMIT}
      value={text}
      placeholder="What you decided, who you asked, what the vendor said"
      hint="Optional. Kept with this report and included in the PDF."
      onChange={(e) => {
        typed.current = e.target.value;
        setText(e.target.value);
      }}
      onBlur={commit}
    />
  );
}

interface FindingDetailsProps {
  finding: Finding;
  /** The contract terms this finding points to. */
  related: readonly ContractTerm[];
  onUpdate: (findingId: string, patch: FindingPatch) => void;
  /** Why the latest change could not be saved, or null when everything is saved. */
  saveError: string | null;
  onRetrySave: () => void;
}

function FindingDetails({ finding, related, onUpdate, saveError, onRetrySave }: FindingDetailsProps) {
  const dismissed = finding.status === "dismissed";
  const fromAi = isAiFinding(finding);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={finding.severity} />
        {fromAi ? <AiBadge>AI reading</AiBadge> : null}
        {awaitsReview(finding) ? <NeedsReviewBadge /> : null}
        <Badge className="whitespace-normal">{findingTypeLabel(finding.type)}</Badge>
        <StatusBadge status={finding.status} />
      </div>

      {fromAi ? (
        <Notice className="mt-4" title="An observation from Gemini's reading of the contract">
          <p>
            It is about the wording quoted below, not about your claims, so it has no dollar estimate and adds nothing
            to the report totals. The severity is Gemini&rsquo;s judgement
            {finding.confidence ? `, given with ${severityLabel(finding.confidence).toLowerCase()} confidence` : ""}. Read the
            quoted wording and decide for yourself. It is not legal advice.
          </p>
          {finding.needsReview ? <p className="mt-1">Gemini was not sure about this one.</p> : null}
        </Notice>
      ) : (
        <dl className="mt-4 rounded-lg border border-line bg-surface-2 px-4 py-3">
          <dt className="text-xs text-muted">Estimated impact</dt>
          <dd className="num mt-0.5 text-2xl font-semibold text-ink">{impactText(finding)}</dd>
          {dismissed && finding.estimatedImpactUSD !== null ? (
            <dd className="mt-1 text-xs text-muted">Dismissed, so it is not counted in the report totals.</dd>
          ) : null}
        </dl>
      )}

      <Section title={fromAi ? "What Gemini noticed" : "What was found"}>
        <p className="break-words text-ink">{finding.explanation}</p>
      </Section>

      {finding.evidence.length > 0 ? (
        <Section title="Evidence">
          <ul className="space-y-3">
            {finding.evidence.map((e, i) => {
              const Icon = e.page > 0 ? FileText : Table2;
              return (
                <li key={i}>
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {evidenceSource(e.page)}
                  </p>
                  <p className="num mt-1 whitespace-pre-line break-words rounded-lg border border-line bg-surface-2 px-3 py-2 text-ink">
                    {e.snippet}
                  </p>
                </li>
              );
            })}
          </ul>
          {fromAi ? (
            <p className="mt-2 text-xs text-muted">Checked: each quotation is on the stated page of the contract.</p>
          ) : null}
        </Section>
      ) : null}

      {related.length > 0 ? (
        <Section title="Contract terms this is about">
          <ul className="divide-y divide-line rounded-lg border border-line">
            {related.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2">
                <span className="min-w-0 break-words text-ink">{termTitle(t)}</span>
                <span className="num text-xs text-muted">
                  {describeTermValue(t)} · page {t.pageRef}
                  {t.confirmed ? "" : " · not confirmed"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {finding.calc ? (
        <Section title="How this was worked out">
          <ol className="num space-y-1.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[13px] leading-5 text-ink">
            {finding.calc.split("\n").map((line, i) => (
              <li key={i} className="break-words">
                {line}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section title="Your review">
        <fieldset>
          <legend className="sr-only">Status of this finding</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {FINDING_STATUSES.map((s) => {
              const checked = finding.status === s.value;
              return (
                <label
                  key={s.value}
                  className={cn(
                    "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors duration-150",
                    checked ? "border-brand bg-brand-soft" : "border-line hover:border-line-strong",
                  )}
                >
                  <input
                    type="radio"
                    name={`status-${finding.id}`}
                    value={s.value}
                    checked={checked}
                    onChange={() => onUpdate(finding.id, { status: s.value })}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{s.label}</span>
                    <span className="block text-xs text-muted">{s.help}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="mt-4">
          <NoteField finding={finding} onSave={(note) => onUpdate(finding.id, { note })} />
        </div>
        {saveError ? (
          <Notice tone="error" className="mt-3" title="Your last change was not saved">
            <p>{saveError}</p>
            <p className="mt-1">It is shown here, but it will be lost when you leave this page.</p>
            <Button variant="secondary" size="sm" className="mt-2" onClick={onRetrySave}>
              Try again
            </Button>
          </Notice>
        ) : (
          <p className="mt-3 text-xs text-muted">Your review is saved {STORAGE_TEXT.savedIn} as you make it.</p>
        )}
      </Section>
    </>
  );
}

/** Side panel for one finding: what was found, the evidence, how the number was worked out, and the reviewer's decision. */
export function FindingDrawer({ findings, terms, open, onNavigate, onClose, onUpdate, saveError, onRetrySave }: FindingDrawerProps) {
  const finding = open ? (findings.find((f) => f.id === open.id) ?? null) : null;
  const order = open?.order ?? [];
  const index = open ? order.indexOf(open.id) : -1;
  const previousId = index > 0 ? order[index - 1] : null;
  const nextId = index !== -1 && index < order.length - 1 ? order[index + 1] : null;
  const position = `Finding ${index + 1} of ${order.length}`;

  return (
    <Drawer
      open={finding !== null}
      onClose={onClose}
      title={finding?.title ?? "Finding"}
      description={position}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="w-10 px-0"
              aria-label="Previous finding"
              disabled={!previousId}
              onClick={() => previousId && onNavigate(previousId)}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              variant="secondary"
              className="w-10 px-0"
              aria-label="Next finding"
              disabled={!nextId}
              onClick={() => nextId && onNavigate(nextId)}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      {finding ? (
        <>
          {/* Read out when Previous or Next changes the finding, since focus stays on the button. */}
          <p className="sr-only" aria-live="polite">
            {position}: {finding.title}
          </p>
          <FindingDetails
            key={finding.id}
            finding={finding}
            related={(finding.relatedTermIds ?? []).flatMap((id) => terms.filter((t) => t.id === id))}
            onUpdate={onUpdate}
            saveError={saveError}
            onRetrySave={onRetrySave}
          />
        </>
      ) : null}
    </Drawer>
  );
}
