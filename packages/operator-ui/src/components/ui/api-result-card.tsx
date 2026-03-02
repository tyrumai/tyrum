import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { cn } from "../../lib/cn.js";
import { Alert } from "./alert.js";
import { Card, CardContent, CardHeader } from "./card.js";
import { JsonViewer } from "./json-viewer.js";

function normalizeErrorValue(error: unknown): unknown {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return error;
}

export interface ApiResultCardProps extends React.HTMLAttributes<HTMLDivElement> {
  heading?: React.ReactNode;
  value?: unknown;
  error?: unknown;
  jsonViewerProps?: Omit<React.ComponentProps<typeof JsonViewer>, "value">;
}

export function ApiResultCard({
  heading = "Result",
  value,
  error,
  jsonViewerProps,
  className,
  ...props
}: ApiResultCardProps): React.ReactElement | null {
  if (typeof value === "undefined" && typeof error === "undefined") return null;

  const isError = typeof error !== "undefined" && error !== null;
  const alert = isError ? (
    <Alert variant="error" title="Error" description={formatErrorMessage(error)} />
  ) : (
    <Alert variant="success" title="Success" />
  );

  const jsonValue = isError ? normalizeErrorValue(error) : value;

  return (
    <Card className={cn("overflow-hidden", className)} {...props}>
      <CardHeader>
        <div className="text-sm font-medium text-fg">{heading}</div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {alert}
        <JsonViewer value={jsonValue} {...jsonViewerProps} />
      </CardContent>
    </Card>
  );
}
