import * as React from "react";
import { isRecord } from "../../utils/is-record.js";
import { cn } from "../../lib/cn.js";
import { Button } from "./button.js";

function formatLeafValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

function serializeJsonValue(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (typeof serialized === "string") return serialized;
  } catch {
    // ignore
  }
  return String(value);
}

function JsonTreeNode({
  name,
  value,
  level,
  defaultExpandedDepth,
}: {
  name: string;
  value: unknown;
  level: number;
  defaultExpandedDepth: number;
}) {
  if (Array.isArray(value)) {
    const preview = `${name}: [${String(value.length)}]`;
    return (
      <details className="ml-3" open={level < defaultExpandedDepth}>
        <summary className="cursor-pointer select-none text-xs text-fg">{preview}</summary>
        <div className="mt-1 grid gap-1">
          {value.map((entry, index) => (
            <JsonTreeNode
              key={index}
              name={String(index)}
              value={entry}
              level={level + 1}
              defaultExpandedDepth={defaultExpandedDepth}
            />
          ))}
        </div>
      </details>
    );
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    const preview = `${name}: {${String(keys.length)}}`;
    return (
      <details className="ml-3" open={level < defaultExpandedDepth}>
        <summary className="cursor-pointer select-none text-xs text-fg">{preview}</summary>
        <div className="mt-1 grid gap-1">
          {keys.map((key) => (
            <JsonTreeNode
              key={key}
              name={key}
              value={value[key]}
              level={level + 1}
              defaultExpandedDepth={defaultExpandedDepth}
            />
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className="ml-3 flex flex-wrap items-center gap-2 text-xs text-fg">
      <span className="text-fg-muted">{name}</span>
      <span className="font-mono">{formatLeafValue(value)}</span>
    </div>
  );
}

export interface JsonViewerProps extends React.HTMLAttributes<HTMLDivElement> {
  value: unknown;
  defaultExpandedDepth?: number;
  withCopyButton?: boolean;
  contentClassName?: string;
}

export function JsonViewer({
  value,
  defaultExpandedDepth = 2,
  withCopyButton = true,
  contentClassName,
  className,
  ...props
}: JsonViewerProps): React.ReactElement {
  const copy = (): void => {
    const serialized = serializeJsonValue(value);
    const clipboard = globalThis.navigator?.clipboard;
    const promise = clipboard?.writeText?.(serialized);
    promise?.catch?.(() => {});
  };

  return (
    <div className={cn("grid gap-2", className)} {...props}>
      {withCopyButton ? (
        <div className="flex items-center justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Copy JSON"
            onClick={() => {
              copy();
            }}
          >
            Copy
          </Button>
        </div>
      ) : null}
      <div
        className={cn(
          "overflow-auto rounded-md border border-border bg-bg px-3 py-2",
          contentClassName,
        )}
      >
        <JsonTreeNode
          name="root"
          value={value}
          level={0}
          defaultExpandedDepth={defaultExpandedDepth}
        />
      </div>
    </div>
  );
}
