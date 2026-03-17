import * as React from "react";
import { cn } from "../../lib/cn.js";

export interface DataTableColumn<T> {
  /** Unique key for the column. */
  id: string;
  /** Header label. */
  header: React.ReactNode;
  /** Render the cell content for a row. */
  cell: (row: T) => React.ReactNode;
  /** Optional extra className for `<th>`. */
  headerClassName?: string;
  /** Optional extra className for `<td>`. */
  cellClassName?: string;
}

export interface DataTableProps<T> extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  columns: DataTableColumn<T>[];
  data: readonly T[];
  /** Unique key extractor for each row. */
  rowKey: (row: T) => string;
  /** Optional className applied to each `<tr>`. */
  rowClassName?: string | ((row: T) => string);
  /** Optional callback to render content after a row (e.g. expandable detail panels). */
  renderAfterRow?: (row: T) => React.ReactNode;
  /** Optional data-testid prefix; each row gets `${testIdPrefix}-${rowKey}`. */
  testIdPrefix?: string;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  rowClassName,
  renderAfterRow,
  testIdPrefix,
  className,
  ...props
}: DataTableProps<T>) {
  return (
    <div className={cn("overflow-x-auto rounded-lg border border-border", className)} {...props}>
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="bg-bg-subtle/60 text-xs font-medium uppercase tracking-wide text-fg-muted">
          <tr>
            {columns.map((col) => (
              <th key={col.id} className={cn("px-3 py-2 font-medium", col.headerClassName)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const key = rowKey(row);
            return (
              <React.Fragment key={key}>
                <tr
                  className={cn(
                    "border-t border-border",
                    typeof rowClassName === "function" ? rowClassName(row) : rowClassName,
                  )}
                  data-testid={testIdPrefix ? `${testIdPrefix}-${key}` : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.id} className={cn("px-3 py-3", col.cellClassName)}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
                {renderAfterRow?.(row)}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
