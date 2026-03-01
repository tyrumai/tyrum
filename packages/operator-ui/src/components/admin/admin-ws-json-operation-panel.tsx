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

type ParsedPayload = { ok: true; payload: Record<string, unknown> } | { ok: false; error: string };

function parsePayload(raw: string): ParsedPayload {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "Payload is required." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch (err) {
    return { ok: false, error: formatErrorMessage(err) };
  }

  if (!isRecord(parsed)) return { ok: false, error: "Payload must be a JSON object." };
  return { ok: true, payload: parsed };
}

function AdminWsJsonOperationPanelHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}): React.ReactElement {
  return (
    <CardHeader className="grid gap-1 pb-4">
      <div className="text-sm font-medium text-fg">{title}</div>
      {description ? <div className="text-sm text-fg-muted">{description}</div> : null}
    </CardHeader>
  );
}

function AdminWsJsonOperationPanelOutcome({
  requestError,
  result,
  resultTestId,
}: {
  requestError: string | null;
  result: unknown | undefined;
  resultTestId?: string;
}): React.ReactElement {
  return (
    <>
      {requestError ? (
        <Alert variant="error" title="Request failed" description={requestError} />
      ) : null}
      {result !== undefined ? <JsonViewer data-testid={resultTestId} value={result} /> : null}
    </>
  );
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
  const [payloadError, setPayloadError] = React.useState<string | null>(null);
  const [requestError, setRequestError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<unknown | undefined>(undefined);

  const execute = async (): Promise<void> => {
    if (busy) return;

    setResult(undefined);
    setPayloadError(null);
    setRequestError(null);

    const parsedPayload = parsePayload(payloadRef.current?.value ?? initialRawPayload.current);
    if (!parsedPayload.ok) {
      setPayloadError(parsedPayload.error);
      return;
    }

    setBusy(true);

    try {
      const nextResult = await onExecute(parsedPayload.payload);
      setResult(nextResult);
    } catch (err) {
      setRequestError(formatErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <AdminWsJsonOperationPanelHeader title={title} description={description} />
      <CardContent className="grid gap-4">
        <Textarea
          ref={payloadRef}
          label="Payload"
          defaultValue={initialRawPayload.current}
          data-testid={payloadTestId}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={() => {
            setPayloadError(null);
            setRequestError(null);
          }}
          error={payloadError}
          helperText="Enter a JSON object payload."
        />

        <div className="flex items-center gap-2">
          <Button
            data-testid={executeTestId}
            variant="secondary"
            isLoading={busy}
            onClick={() => void execute()}
          >
            {busy ? "Running..." : executeLabel}
          </Button>
        </div>

        <AdminWsJsonOperationPanelOutcome
          requestError={requestError}
          result={result}
          resultTestId={resultTestId}
        />
      </CardContent>
    </Card>
  );
}
