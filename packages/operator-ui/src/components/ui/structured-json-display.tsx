import * as React from "react";
import { cn } from "../../lib/cn.js";
import { StructuredValue } from "./structured-value.js";

export interface StructuredJsonDisplayProps extends React.HTMLAttributes<HTMLDivElement> {
  value: unknown;
  maxDepth?: number;
}

export function StructuredJsonDisplay({
  value,
  maxDepth,
  className,
  ...props
}: StructuredJsonDisplayProps): React.ReactElement {
  return (
    <div
      className={cn(
        "max-h-[420px] overflow-auto rounded-md border border-border bg-bg px-2 py-1.5",
        className,
      )}
      {...props}
    >
      <StructuredValue value={value} maxDepth={maxDepth} />
    </div>
  );
}
