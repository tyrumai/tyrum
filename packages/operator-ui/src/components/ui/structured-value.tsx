import { formatSharedMessage } from "../../i18n/messages.js";
import { cn } from "../../lib/cn.js";

const DEFAULT_MAX_DEPTH = 4;

/**
 * Convert a snake_case or camelCase key to a human-readable label.
 * Examples: "timeout_ms" → "Timeout ms", "retryCount" → "Retry count"
 */
export function formatFieldLabel(key: string): string {
  // Split on underscores and camelCase boundaries.
  const words = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return key;
  const first = words[0]!;
  words[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(" ");
}

export interface StructuredValueProps {
  value: unknown;
  /** Maximum nesting depth before truncating. @default 4 */
  maxDepth?: number;
}

export function StructuredValue({ value, maxDepth = DEFAULT_MAX_DEPTH }: StructuredValueProps) {
  return <StructuredNode value={value} depth={0} maxDepth={maxDepth} />;
}

function StructuredNode({
  value,
  depth,
  maxDepth,
}: {
  value: unknown;
  depth: number;
  maxDepth: number;
}) {
  if (value === null || value === undefined) {
    return <span className="text-fg-muted">—</span>;
  }

  if (typeof value === "boolean") {
    return (
      <span className="text-sm text-fg">
        {value ? formatSharedMessage("Yes") : formatSharedMessage("No")}
      </span>
    );
  }

  if (typeof value === "number") {
    return <span className="text-sm text-fg">{String(value)}</span>;
  }

  if (typeof value === "string") {
    return <span className="text-sm text-fg break-words [overflow-wrap:anywhere]">{value}</span>;
  }

  if (depth >= maxDepth) {
    return <span className="text-sm text-fg-muted">…</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-fg-muted">—</span>;
    }
    return (
      <ol className="grid gap-1.5">
        {value.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span className="shrink-0 text-fg-muted">{i + 1}.</span>
            <StructuredNode value={item} depth={depth + 1} maxDepth={maxDepth} />
          </li>
        ))}
      </ol>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return <span className="text-fg-muted">—</span>;
    }
    return (
      <div className={cn("grid gap-1.5", depth > 0 && "pl-3")}>
        {entries.map(([key, val]) => (
          <div key={key} className="grid gap-0.5">
            <div className="text-xs font-medium text-fg-muted">{formatFieldLabel(key)}</div>
            <div className="text-sm text-fg">
              <StructuredNode value={val} depth={depth + 1} maxDepth={maxDepth} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <span className="text-sm text-fg">{String(value)}</span>;
}
