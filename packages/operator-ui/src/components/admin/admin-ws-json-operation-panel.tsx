import * as React from "react";
import { isRecord } from "../../utils/is-record.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { JsonViewer } from "../ui/json-viewer.js";
import { Textarea } from "../ui/textarea.js";

export interface AdminWsJsonOperationPanelProps {
  title: string;
  description?: string;
  initialPayload: Record<string, unknown>;
  executeLabel: string;
  onExecute: (payload: Record<string, unknown>) => Promise<unknown>;
  payloadTestId: string;
  executeTestId: string;
  resultTestId?: string;
}

export function AdminWsJsonOperationPanel({
  title,
  description,
  initialPayload,
  executeLabel,
  onExecute,
  payloadTestId,
  executeTestId,
  resultTestId,
}: AdminWsJsonOperationPanelProps): React.ReactElement {
  const payloadRef = React.useRef<HTMLTextAreaElement | null>(null);
  const initialRawPayload = React.useRef(JSON.stringify(initialPayload, null, 2));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<unknown>(null);

  const execute = async (): Promise<void> => {
    if (busy) return;

    const trimmed = (payloadRef.current?.value ?? initialRawPayload.current).trim();
    if (!trimmed) {
      setError("Payload is required.");
      return;
    }

    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(trimmed) as unknown;
    } catch (err) {
      setError(formatErrorMessage(err));
      return;
    }

    if (!isRecord(parsedPayload)) {
      setError("Payload must be a JSON object.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const nextResult = await onExecute(parsedPayload);
      setResult(nextResult);
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="grid gap-1 pb-4">
        <div className="text-sm font-medium text-fg">{title}</div>
        {description ? <div className="text-sm text-fg-muted">{description}</div> : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        <Textarea
          ref={payloadRef}
          label="Payload"
          defaultValue={initialRawPayload.current}
          data-testid={payloadTestId}
          onChange={(event) => {
            if (event.target.value === initialRawPayload.current) return;
            setError(null);
          }}
          error={error}
          helperText="Enter a JSON object payload."
        />

        <div className="flex items-center gap-2">
          <Button
            data-testid={executeTestId}
            variant="secondary"
            isLoading={busy}
            onClick={() => {
              void execute();
            }}
          >
            {busy ? "Running..." : executeLabel}
          </Button>
        </div>

        {error ? <Alert variant="error" title="Request failed" description={error} /> : null}
        {result ? <JsonViewer data-testid={resultTestId} value={result} /> : null}
      </CardContent>
    </Card>
  );
}
