import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/cn.js";
import { translateNode, translateString, useI18n } from "../../i18n-helpers.js";

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
  /** Value accessor for sorting. If provided and `sortable` is true, the column header becomes sortable. */
  sortValue?: (row: T) => string | number | null;
}

type SortDirection = "asc" | "desc";

export interface DataTableProps<T> extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  columns: DataTableColumn<T>[];
  data: readonly T[];
  /** Unique key extractor for each row. */
  rowKey: (row: T) => string;
  /** Optional callback invoked when a row is clicked. */
  onRowClick?: (row: T) => void;
  /** Optional accessible label for clickable rows. */
  rowAriaLabel?: (row: T) => string;
  /** Optional className applied to each `<tr>`. */
  rowClassName?: string | ((row: T) => string);
  /** Optional callback to render content after a row (e.g. expandable detail panels). */
  renderAfterRow?: (row: T) => React.ReactNode;
  /** Optional data-testid prefix; each row gets `${testIdPrefix}-${rowKey}`. */
  testIdPrefix?: string;
  /** Enable sortable column headers for columns that define `sortValue`. */
  sortable?: boolean;
  /** Apply alternating row background tint for readability. */
  striped?: boolean;
  /** Render expanded content below a row. Enables click-to-expand and a left chevron column. */
  renderExpandedRow?: (row: T) => React.ReactNode;
  /** Controlled expanded row key. Omit for internal state management. */
  expandedRowKey?: string | null;
  /** Callback when a row's expand state is toggled. */
  onExpandedRowChange?: (key: string | null) => void;
}

function compareSortValues(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return (a as number) - (b as number);
}

function SortableHeader({
  column,
  activeSortId,
  direction,
  onSort,
}: {
  column: { id: string; header: React.ReactNode; headerClassName?: string };
  activeSortId: string | null;
  direction: SortDirection;
  onSort: (id: string) => void;
}) {
  const intl = useI18n();
  const isActive = column.id === activeSortId;
  const Icon = isActive ? (direction === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <th
      key={column.id}
      aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-2 font-medium", column.headerClassName)}
    >
      <button
        type="button"
        className="flex items-center gap-1 text-left text-xs font-medium uppercase tracking-wide text-fg-muted transition-colors hover:text-fg"
        onClick={() => onSort(column.id)}
      >
        {translateNode(intl, column.header)}
        <Icon aria-hidden className="h-3 w-3 shrink-0" />
      </button>
    </th>
  );
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  rowAriaLabel,
  rowClassName,
  renderAfterRow,
  testIdPrefix,
  sortable = false,
  striped = false,
  renderExpandedRow,
  expandedRowKey: controlledExpandedKey,
  onExpandedRowChange,
  className,
  ...props
}: DataTableProps<T>) {
  const intl = useI18n();
  const [sortColumnId, setSortColumnId] = React.useState<string | null>(null);
  const [sortDirection, setSortDirection] = React.useState<SortDirection>("asc");
  const [internalExpandedKey, setInternalExpandedKey] = React.useState<string | null>(null);

  const isExpandable = renderExpandedRow !== undefined;
  const isControlledExpand = controlledExpandedKey !== undefined;
  const expandedKey = isControlledExpand ? controlledExpandedKey : internalExpandedKey;
  const isRowClickable = typeof onRowClick === "function" && !isExpandable;

  const toggleExpand = React.useCallback(
    (key: string) => {
      const next = expandedKey === key ? null : key;
      if (isControlledExpand) {
        onExpandedRowChange?.(next);
      } else {
        setInternalExpandedKey(next);
      }
    },
    [expandedKey, isControlledExpand, onExpandedRowChange],
  );

  const handleSort = React.useCallback(
    (id: string) => {
      if (sortColumnId !== id) {
        setSortColumnId(id);
        setSortDirection("asc");
      } else if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        setSortColumnId(null);
        setSortDirection("asc");
      }
    },
    [sortColumnId, sortDirection],
  );

  const sortedData = React.useMemo(() => {
    if (!sortable || !sortColumnId) return data;
    const col = columns.find((c) => c.id === sortColumnId);
    if (!col?.sortValue) return data;
    const accessor = col.sortValue;
    const dir = sortDirection === "asc" ? 1 : -1;
    return data.toSorted((a, b) => dir * compareSortValues(accessor(a), accessor(b)));
  }, [data, sortable, sortColumnId, sortDirection, columns]);

  const totalColumns = columns.length + (isExpandable ? 1 : 0);

  return (
    <div className={cn("overflow-x-auto rounded-lg border border-border", className)} {...props}>
      <table className="min-w-full border-collapse text-left text-sm">
        <thead className="bg-bg-subtle/60 text-xs font-medium uppercase tracking-wide text-fg-muted">
          <tr>
            {isExpandable ? (
              <th className="w-8 px-1 py-2" aria-label={translateString(intl, "Expand")} />
            ) : null}
            {columns.map((col) =>
              sortable && col.sortValue ? (
                <SortableHeader
                  key={col.id}
                  column={col}
                  activeSortId={sortColumnId}
                  direction={sortDirection}
                  onSort={handleSort}
                />
              ) : (
                <th key={col.id} className={cn("px-3 py-2 font-medium", col.headerClassName)}>
                  {translateNode(intl, col.header)}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, index) => {
            const key = rowKey(row);
            const isExpanded = isExpandable && expandedKey === key;
            const expandedContent = isExpanded ? renderExpandedRow?.(row) : null;
            return (
              <React.Fragment key={key}>
                <tr
                  className={cn(
                    "border-t border-border transition-colors",
                    striped && index % 2 === 1 && "bg-bg-subtle/30",
                    isExpandable && "cursor-pointer hover:bg-bg-subtle/60",
                    isRowClickable && "cursor-pointer hover:bg-bg-subtle/40",
                    typeof rowClassName === "function" ? rowClassName(row) : rowClassName,
                  )}
                  data-testid={testIdPrefix ? `${testIdPrefix}-${key}` : undefined}
                  aria-label={isRowClickable ? rowAriaLabel?.(row) : undefined}
                  tabIndex={isRowClickable ? 0 : undefined}
                  onClick={
                    isExpandable
                      ? () => toggleExpand(key)
                      : isRowClickable
                        ? () => onRowClick(row)
                        : undefined
                  }
                  onKeyDown={
                    isRowClickable
                      ? (event) => {
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }
                          event.preventDefault();
                          onRowClick(row);
                        }
                      : undefined
                  }
                >
                  {isExpandable ? (
                    <td className="w-8 px-1 py-3 text-center">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={translateString(
                          intl,
                          isExpanded ? "Collapse row" : "Expand row",
                        )}
                        className="inline-flex items-center justify-center rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpand(key);
                        }}
                      >
                        <ChevronRight
                          aria-hidden
                          className={cn(
                            "h-3.5 w-3.5 text-fg-muted/50 transition-transform",
                            isExpanded && "rotate-90",
                          )}
                        />
                      </button>
                    </td>
                  ) : null}
                  {columns.map((col) => (
                    <td key={col.id} className={cn("px-3 py-3", col.cellClassName)}>
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
                {expandedContent ? (
                  <tr className="border-t border-border">
                    <td colSpan={totalColumns} className="bg-bg-subtle/20 px-4 py-4 md:px-5">
                      {expandedContent}
                    </td>
                  </tr>
                ) : null}
                {renderAfterRow?.(row)}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
