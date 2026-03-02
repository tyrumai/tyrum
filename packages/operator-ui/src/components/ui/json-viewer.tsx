import * as React from "react";
import { toast } from "sonner";
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
  withDownloadButton?: boolean;
  downloadFileName?: string;
  contentClassName?: string;
}

export function JsonViewer({
  value,
  defaultExpandedDepth = 2,
  withCopyButton = true,
  withDownloadButton = false,
  downloadFileName = "data.json",
  contentClassName,
  className,
  ...props
}: JsonViewerProps): React.ReactElement {
  const clipboard = globalThis.navigator?.clipboard;
  const canCopy = withCopyButton && typeof clipboard?.writeText === "function";
  const canDownload =
    withDownloadButton &&
    typeof globalThis.Blob === "function" &&
    typeof globalThis.URL?.createObjectURL === "function" &&
    typeof globalThis.document?.createElement === "function";

  const copy = (): void => {
    if (!canCopy) return;
    const serialized = serializeJsonValue(value);
    void clipboard
      .writeText(serialized)
      .then(() => {
        toast.success("Copied to clipboard");
      })
      .catch(() => {
        toast.error("Failed to copy to clipboard");
      });
  };

  const download = (): void => {
    if (!canDownload) return;
    const serialized = serializeJsonValue(value);
    const blob = new Blob([serialized], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadFileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      const revoke = () => {
        URL.revokeObjectURL(url);
      };
      if (typeof globalThis.queueMicrotask === "function") {
        queueMicrotask(revoke);
      } else {
        setTimeout(revoke, 0);
      }
    }
  };

  return (
    <div className={cn("grid gap-2", className)} {...props}>
      {canCopy || canDownload ? (
        <div className="flex items-center justify-end gap-2">
          {canDownload ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="Download JSON"
              onClick={() => {
                download();
              }}
            >
              Download
            </Button>
          ) : null}
          {canCopy ? (
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
          ) : null}
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
