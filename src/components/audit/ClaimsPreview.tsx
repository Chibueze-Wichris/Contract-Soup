import { AlertTriangle } from "lucide-react";
import { CLAIM_FIELDS, PREVIEW_ROWS, type ClaimsResult, type ColumnMapping, type CsvTable } from "@/lib/claimsCsv";
import { cn } from "@/lib/cn";
import { formatCount, plural } from "@/lib/format";

interface ClaimsPreviewProps {
  table: CsvTable;
  mapping: ColumnMapping;
  result: ClaimsResult;
}

/** The first rows of the claims file as they are in the file, with what each column is used for under its name. */
export function ClaimsPreview({ table, mapping, result }: ClaimsPreviewProps) {
  const rows = table.rows.slice(0, PREVIEW_ROWS);
  // A column can serve two fields: one amount column may be both billed and paid.
  const usedFor = table.headers.map((_, column) =>
    CLAIM_FIELDS.filter((f) => mapping[f.key] === column)
      .map((f) => f.label)
      .join(", "),
  );

  // Cells that keep a row out of the audit, as "row:column". Row numbers count the column names as row 1.
  const problemCells = new Set<string>();
  const problemRows = new Set<number>();
  for (const issue of result.issues) {
    if (issue.row > rows.length + 1) break; // problems are listed in file order
    problemRows.add(issue.row);
    const column = mapping[issue.field];
    if (column !== null) problemCells.add(`${issue.row}:${column}`);
  }

  return (
    <section className="mt-6" aria-labelledby="claims-preview-heading">
      <h3 id="claims-preview-heading" className="text-sm font-semibold text-ink">
        First rows of your file
      </h3>
      <p className="num mt-0.5 text-xs text-muted">
        {rows.length < table.rows.length
          ? `The first ${rows.length} of ${plural(table.rows.length, "row")}, as they are in the file.`
          : `All ${plural(table.rows.length, "row")}, as they are in the file.`}{" "}
        Under each column name is what it is used for.
        {problemRows.size > 0 ? " Marked rows will be left out." : ""}
      </p>
      <div
        role="region"
        aria-labelledby="claims-preview-heading"
        tabIndex={0}
        className="relative mt-3 overflow-x-auto rounded-lg border border-line"
      >
        <table className="w-full min-w-max border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2 align-top">
              <th scope="col" className="px-3 py-2 font-medium text-muted">
                Row
              </th>
              {table.headers.map((header, column) => (
                <th key={column} scope="col" className="max-w-56 px-3 py-2 font-medium">
                  <span className={cn("block truncate", usedFor[column] ? "text-ink" : "text-muted")}>{header}</span>
                  <span className={cn("mt-0.5 block font-normal", usedFor[column] ? "text-brand" : "text-muted")}>
                    {usedFor[column] || "Not used"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {rows.map((row, r) => {
              const rowNumber = r + 2;
              const leftOut = problemRows.has(rowNumber);
              return (
                <tr key={r} className="border-b border-line last:border-b-0">
                  <th scope="row" className="whitespace-nowrap px-3 py-1.5 font-normal text-muted">
                    {formatCount(rowNumber)}
                    {leftOut ? (
                      <>
                        <AlertTriangle className="ml-1 inline h-3 w-3 text-medium-ink" aria-hidden="true" />
                        <span className="sr-only"> (will be left out)</span>
                      </>
                    ) : null}
                  </th>
                  {table.headers.map((_, column) => {
                    const problem = problemCells.has(`${rowNumber}:${column}`);
                    return (
                      <td
                        key={column}
                        className={cn(
                          "max-w-56 truncate px-3 py-1.5",
                          usedFor[column] ? "text-ink" : "text-muted",
                          problem && "bg-amber-soft",
                        )}
                      >
                        {row[column] ?? ""}
                        {problem ? <span className="sr-only"> (cannot be used)</span> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
