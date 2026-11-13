import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { Notice } from "@/components/ui";
import { CLAIM_FIELDS, headersLookLikeData, type ClaimsResult, type CsvTable } from "@/lib/claimsCsv";
import { formatCount, formatIsoDate, formatUsd, plural } from "@/lib/format";

interface ClaimsCheckProps {
  table: CsvTable;
  result: ClaimsResult;
}

/** What was read from the claims file: how many rows are usable, a few totals to check against, and any problems. */
export function ClaimsCheck({ table, result }: ClaimsCheckProps) {
  const { claims, totalRows, skippedRows, exampleRows } = result;
  const unreadableRows = skippedRows - exampleRows;
  const unmatched = Object.keys(result.mappingErrors).length;

  // Totals the user can compare with their own spreadsheet to see that dates and amounts were read correctly.
  const facts = useMemo(() => {
    if (claims.length === 0) return null;
    let first = claims[0].date;
    let last = claims[0].date;
    let billed = 0;
    let paid = 0;
    for (const c of claims) {
      if (c.date < first) first = c.date;
      if (c.date > last) last = c.date;
      billed += c.billed;
      paid += c.paid;
    }
    return { first, last, billed, paid };
  }, [claims]);

  const byField = CLAIM_FIELDS.filter((f) => result.issuesByField[f.key]).map(
    (f) => `${f.label} ${formatCount(result.issuesByField[f.key] ?? 0)}`,
  );

  return (
    <div className="mt-4 space-y-3">
      {table.warnings.map((warning) => (
        <Notice key={warning} tone="warning">
          {warning}
        </Notice>
      ))}
      {headersLookLikeData(table.headers) ? (
        <Notice tone="warning" title="The first row looks like data, not column names">
          The first row of a file is always read as its column names, so that row is not counted. Add a row of column
          names at the top and add the file again.
        </Notice>
      ) : null}

      {unmatched > 0 ? (
        <Notice tone="warning" role="status" title="Match the columns below to continue">
          {unmatched === 1 ? "One field still needs" : `${unmatched} fields still need`} a column from your file.
        </Notice>
      ) : claims.length === 0 && exampleRows === totalRows ? (
        <Notice tone="error" title="This file holds only the template's example rows">
          Replace the example rows with your own claims, save the file as a CSV and add it again.
        </Notice>
      ) : claims.length === 0 ? (
        <Notice tone="error" title="None of the rows could be used">
          Every row is missing a required value, or has a date or an amount that could not be read. Check that each field
          below is matched to the right column.
        </Notice>
      ) : (
        <Notice
          tone={skippedRows > 0 ? "warning" : "success"}
          role="status"
          title={
            skippedRows > 0
              ? `${formatCount(claims.length)} of ${plural(totalRows, "row")} are ready`
              : totalRows === 1
                ? "The 1 row is ready"
                : `All ${formatCount(totalRows)} rows are ready`
          }
        >
          {unreadableRows > 0 ? (
            <p>
              {plural(unreadableRows, "row")} will be left out because a required value is missing or could not be read.
            </p>
          ) : null}
          {exampleRows > 0 ? (
            <p>
              {exampleRows === 1
                ? "The template's example row will be left out."
                : `The template's ${formatCount(exampleRows)} example rows will be left out.`}
            </p>
          ) : null}
          {facts ? (
            <p className="num text-muted">
              {facts.first === facts.last
                ? `Dated ${formatIsoDate(facts.first)}.`
                : `Dated ${formatIsoDate(facts.first)} to ${formatIsoDate(facts.last)}.`}{" "}
              Billed adds up to {formatUsd(facts.billed)} and paid to {formatUsd(facts.paid)}.
            </p>
          ) : null}
        </Notice>
      )}

      {result.issueCount > 0 ? (
        <details className="group rounded-lg border border-line">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted transition-transform duration-150 group-open:rotate-90"
              aria-hidden="true"
            />
            {result.issueCount === 1 ? "See the 1 problem" : `See the ${formatCount(result.issueCount)} problems`}
          </summary>
          <div className="border-t border-line px-3 py-3">
            <p className="num text-xs text-muted">By field: {byField.join(", ")}.</p>
            <ul className="num mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
              {result.issues.map((issue, i) => (
                <li key={`${issue.row}-${issue.field}-${i}`}>
                  <span className="font-medium text-ink">Row {formatCount(issue.row)}:</span>{" "}
                  <span className="break-words text-muted">{issue.message}</span>
                </li>
              ))}
            </ul>
            {result.issueCount > result.issues.length ? (
              <p className="mt-2 text-xs text-muted">
                Showing the first {result.issues.length}. Row numbers count the column names as row 1, the way a
                spreadsheet does.
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted">
                Row numbers count the column names as row 1, the way a spreadsheet does.
              </p>
            )}
          </div>
        </details>
      ) : null}
    </div>
  );
}
