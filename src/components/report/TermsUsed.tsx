import { ChevronRight } from "lucide-react";
import type { Audit } from "@/analyzer";
import { categoryLabel, isMoneyCategory } from "@/analyzer/categories";
import { AiBadge, Card } from "@/components/ui";
import { formatCount, plural } from "@/lib/format";
import { describeTermValue, isAiTerm, termNotes, termTitle } from "@/lib/terms";

/** The confirmed contract terms the claims were checked against. Closed until the reader asks for it. */
export function TermsUsed({ audit }: { audit: Audit }) {
  const used = audit.terms.filter((t) => t.confirmed);
  const unused = audit.terms.filter((t) => !t.confirmed);
  const anyFromAi = audit.terms.some(isAiTerm);
  const usedByChecks = used.filter((t) => isMoneyCategory(t.category)).length;
  if (audit.terms.length === 0) return null;

  return (
    <Card padded={false}>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-2 px-5 py-4 focus-visible:outline-offset-[-2px] sm:px-6 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="mt-1 h-4 w-4 shrink-0 text-muted transition-transform duration-150 group-open:rotate-90"
            aria-hidden="true"
          />
          <span className="min-w-0">
            <h2 className="text-base font-semibold text-ink">Contract terms used</h2>
            <span className="mt-1 block break-words text-sm text-muted">
              {formatCount(used.length)} of the {plural(audit.terms.length, "term")} found in {audit.contractFileName}{" "}
              {used.length === 1 ? "was" : "were"} confirmed and used.
              {anyFromAi && used.length > 0
                ? ` The money checks used the ${plural(usedByChecks, "financial term")} among them. The other provisions are kept for reference.`
                : ""}
            </span>
          </span>
        </summary>
        <div className="border-t border-line px-5 py-4 sm:px-6">
          {used.length > 0 ? (
            <div role="region" aria-label="Contract terms used" tabIndex={0} className="relative overflow-x-auto">
              <table className="w-full min-w-[26rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Term
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Value
                    </th>
                    <th scope="col" className="py-2 pl-3 text-right font-medium">
                      Contract page
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {used.map((t) => (
                    <tr key={t.id} className="border-b border-line last:border-b-0">
                      <th scope="row" className="py-2 pr-3 align-top font-normal text-ink">
                        <span className="break-words">{termTitle(t)}</span>
                        {isAiTerm(t) ? (
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <AiBadge />
                            {categoryLabel(t.category) === termTitle(t) ? null : (
                              <span className="text-xs text-muted">{categoryLabel(t.category)}</span>
                            )}
                          </span>
                        ) : null}
                        {termNotes(t).map((note) => (
                          <span key={note} className="mt-1 block break-words text-xs text-muted">
                            {note}
                          </span>
                        ))}
                      </th>
                      <td className="num px-3 py-2 align-top text-ink">{describeTermValue(t)}</td>
                      <td className="num py-2 pl-3 text-right align-top text-muted">{formatCount(t.pageRef)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">No terms were confirmed, so the claims were not checked against the contract.</p>
          )}
          {unused.length > 0 ? (
            <p className="mt-3 text-xs text-muted">
              Found in the contract but not confirmed, so not used: {unused.map((t) => termTitle(t)).join(", ")}.
            </p>
          ) : null}
        </div>
      </details>
    </Card>
  );
}
