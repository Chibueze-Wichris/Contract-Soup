import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui";

const STEPS = [
  { title: "Upload contract", body: "Add a text-based PDF. Pages are read one batch at a time." },
  { title: "Review contract terms", body: "Edit and confirm the terms found. Confirmed terms are used to check your claims." },
  { title: "Upload claims", body: "Optional but recommended. Map your CSV columns and check for errors." },
  { title: "Run audit", body: "Reading terms, checking claims, ranking findings." },
];

/** Phase 0 placeholder. The wizard is built in Phase 2. */
export default function NewAudit() {
  return (
    <>
      <PageHeader title="New audit" description="Four short steps. Your progress is kept if you leave this page." />
      <Card>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-line bg-surface-2 p-4">
              <span className="num flex h-7 w-7 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                {i + 1}
              </span>
              <h2 className="mt-3 text-sm font-semibold">{s.title}</h2>
              <p className="mt-1 text-xs text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
