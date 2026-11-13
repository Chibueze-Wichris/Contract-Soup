import { useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { Button, Notice, Select } from "@/components/ui";
import {
  CLAIM_FIELDS,
  exampleValue,
  parseDate,
  type ClaimsResult,
  type ColumnMapping,
  type CsvTable,
  type DateOrder,
  type DateOrderSetting,
} from "@/lib/claimsCsv";
import { formatIsoDate } from "@/lib/format";
import { useDraftAuditStore } from "@/store/useDraftAuditStore";

interface ColumnMapperProps {
  table: CsvTable;
  mapping: ColumnMapping;
  suggested: ColumnMapping;
  dateOrder: DateOrderSetting;
  result: ClaimsResult;
}

const sameMapping = (a: ColumnMapping, b: ColumnMapping): boolean => CLAIM_FIELDS.every((f) => a[f.key] === b[f.key]);

/**
 * A date from the file to show how dates are being read. One that reads differently month first and day first is
 * preferred, because "01/01/2025" would not show what the choice changes.
 */
function dateExampleFrom(table: CsvTable, column: number | null): string | null {
  if (column === null) return null;
  let first: string | null = null;
  for (let i = 0; i < table.rows.length && i < 500; i += 1) {
    const value = (table.rows[i][column] ?? "").trim();
    if (!value) continue;
    first ??= value;
    const monthFirst = parseDate(value, "mdy");
    const dayFirst = parseDate(value, "dmy");
    if (monthFirst !== null && dayFirst !== null && monthFirst !== dayFirst) return value;
  }
  return first;
}

/** One select per claim field, to choose which column of the file it is read from. */
export function ColumnMapper({ table, mapping, suggested, dateOrder, result }: ColumnMapperProps) {
  const setClaimColumn = useDraftAuditStore((s) => s.setClaimColumn);
  const restoreSuggestedColumns = useDraftAuditStore((s) => s.restoreSuggestedColumns);
  const setDateOrder = useDraftAuditStore((s) => s.setDateOrder);

  const dateExample = useMemo(() => dateExampleFrom(table, mapping.date), [table, mapping.date]);
  const dateRead = dateExample === null ? null : parseDate(dateExample, result.dateOrder);
  const showDateOrder = result.dateOrderAmbiguous || dateOrder !== "auto";

  return (
    <section className="mt-6" aria-labelledby="claims-columns-heading">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="claims-columns-heading" className="text-sm font-semibold text-ink">
            Match your columns
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            These matches were worked out from your column names. Check them and change any that are wrong.
          </p>
        </div>
        {sameMapping(mapping, suggested) ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            icon={<RotateCcw className="h-4 w-4" />}
            onClick={restoreSuggestedColumns}
          >
            Reset
          </Button>
        )}
      </div>

      <div className="mt-3 grid gap-x-4 gap-y-4 @2xl:grid-cols-2">
        {CLAIM_FIELDS.map((field) => {
          const column = mapping[field.key];
          const example = exampleValue(table, column);
          return (
            <Select
              key={field.key}
              label={field.required ? field.label : `${field.label} (optional)`}
              value={column === null ? "" : String(column)}
              error={result.mappingErrors[field.key]}
              hint={
                column !== null && example !== null ? (
                  <span className="block truncate">Example: {example}</span>
                ) : (
                  field.help
                )
              }
              onChange={(e) => setClaimColumn(field.key, e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">{field.required ? "Choose a column" : "Not in this file"}</option>
              {table.headers.map((header, index) => (
                <option key={index} value={index}>
                  {header}
                </option>
              ))}
            </Select>
          );
        })}
      </div>

      {showDateOrder ? (
        <Notice
          tone={result.dateOrderAmbiguous ? "warning" : "info"}
          className="mt-4"
          title={result.dateOrderAmbiguous ? "Check how the dates are read" : "How the dates are read"}
        >
          <p>
            {result.dateOrderAmbiguous
              ? "The dates in this file could be read month first or day first, and nothing in the file settles it. Month first is assumed."
              : "You chose the order below."}
            {dateExample !== null && dateRead !== null ? ` ${dateExample} is read as ${formatIsoDate(dateRead)}.` : ""}
          </p>
          <Select
            label="Dates are written"
            className="mt-3 max-w-xs"
            value={result.dateOrder}
            onChange={(e) => setDateOrder(e.target.value as DateOrder)}
          >
            <option value="mdy">Month first (03/31/2025)</option>
            <option value="dmy">Day first (31/03/2025)</option>
          </Select>
        </Notice>
      ) : null}
    </section>
  );
}
