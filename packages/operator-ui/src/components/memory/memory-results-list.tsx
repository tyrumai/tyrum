import { cn } from "../../lib/cn.js";
import type { BrowseRow } from "./memory-inspector.shared.js";
import { Card, CardContent } from "../ui/card.js";

export interface MemoryResultsListProps {
  browseRows: BrowseRow[];
  browseLoading: boolean;
  inspectedItemId: string | null;
  onInspect: (memoryItemId: string) => void;
}

export function MemoryResultsList({
  browseRows,
  browseLoading,
  inspectedItemId,
  onInspect,
}: MemoryResultsListProps) {
  return (
    <div className="grid gap-2">
      <div className="text-sm font-medium text-fg-muted">Results ({browseRows.length})</div>
      {browseRows.length === 0 && !browseLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-fg-muted">
            No memories found. Try adjusting your filters.
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-1">
        {browseRows.map((row) => (
          <button
            key={row.memoryItemId}
            type="button"
            data-testid={`memory-item-${row.memoryItemId}`}
            className={cn(
              "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
              "hover:bg-bg-subtle",
              inspectedItemId === row.memoryItemId
                ? "border-primary bg-bg-subtle"
                : "border-border bg-bg",
            )}
            onClick={() => {
              onInspect(row.memoryItemId);
            }}
          >
            <div className="font-mono text-xs text-fg-muted break-all">{row.memoryItemId}</div>
            <div
              data-testid={`memory-item-snippet-${row.memoryItemId}`}
              className="break-words text-fg [overflow-wrap:anywhere]"
            >
              {row.snippet}
            </div>
            {row.provenance ? (
              <div
                data-testid={`memory-item-provenance-${row.memoryItemId}`}
                className="break-words text-xs text-fg-muted [overflow-wrap:anywhere]"
              >
                {row.provenance}
              </div>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
