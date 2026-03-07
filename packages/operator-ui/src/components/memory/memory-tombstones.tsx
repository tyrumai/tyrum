import type { MemoryTombstone } from "@tyrum/client";

export interface MemoryTombstonesProps {
  tombstones: MemoryTombstone[];
}

export function MemoryTombstones({ tombstones }: MemoryTombstonesProps) {
  if (tombstones.length === 0) return null;

  return (
    <div data-testid="memory-tombstones">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Tombstones
      </div>
      <div className="grid gap-1">
        {tombstones.map((tombstone) => (
          <div
            key={tombstone.memory_item_id}
            className="rounded-md bg-bg-subtle px-3 py-2 text-xs text-fg-muted"
          >
            <span className="font-mono">{tombstone.memory_item_id}</span>
            {tombstone.deleted_by ? (
              <span className="ml-2">deleted by {tombstone.deleted_by}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
