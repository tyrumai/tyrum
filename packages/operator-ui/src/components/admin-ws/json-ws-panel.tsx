import * as React from "react";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { JsonTextarea } from "../ui/json-textarea.js";
import { Label } from "../ui/label.js";

export type JsonWsPanelProps = {
  title: string;
  description?: string;
  payloadLabel?: string;
  initialPayload: unknown;
  submitLabel?: string;
  resultHeading?: string;
  payloadTestId: string;
  submitTestId: string;
  resultTestId?: string;
  onSubmit: (payload: unknown) => Promise<unknown>;
};

type JsonWsPanelFormProps = {
  title: string;
  description?: string;
  payloadLabel: string;
  payloadTestId: string;
  rawPayload: string;
  onRawPayloadChange: (nextValue: string) => void;
  onJsonChange: (value: unknown | undefined, errorMessage: string | null) => void;
  busy: boolean;
  submitTestId: string;
  submitLabel: string;
  onSubmitClick: () => void;
};

function JsonWsPanelForm({
  title,
  description,
  payloadLabel,
  payloadTestId,
  rawPayload,
  onRawPayloadChange,
  onJsonChange,
  busy,
  submitTestId,
  submitLabel,
  onSubmitClick,
}: JsonWsPanelFormProps): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <div className="grid gap-1">
          <div className="text-sm font-medium text-fg">{title}</div>
          {description ? <div className="text-xs text-fg-muted">{description}</div> : null}
        </div>
      </CardHeader>

      <CardContent className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor={payloadTestId}>{payloadLabel}</Label>
          <JsonTextarea
            id={payloadTestId}
            data-testid={payloadTestId}
            value={rawPayload}
            rows={6}
            onJsonChange={onJsonChange}
            onChange={(event) => {
              onRawPayloadChange(event.target.value);
            }}
          />
        </div>
      </CardContent>

      <CardFooter>
        <Button
          type="button"
          data-testid={submitTestId}
          isLoading={busy}
          disabled={busy}
          onClick={onSubmitClick}
        >
          {submitLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function JsonWsPanel({
  title,
  description,
  payloadLabel = "Payload (JSON)",
  initialPayload,
  submitLabel = "Send",
  resultHeading,
  payloadTestId,
  submitTestId,
  resultTestId,
  onSubmit,
}: JsonWsPanelProps): React.ReactElement {
  const [rawPayload, setRawPayload] = React.useState(() => JSON.stringify(initialPayload, null, 2));
  const [parsedPayload, setParsedPayload] = React.useState<{
    value: unknown | undefined;
    errorMessage: string | null;
  }>(() => ({
    value: initialPayload,
    errorMessage: null,
  }));
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<unknown | undefined>(undefined);
  const [error, setError] = React.useState<unknown | undefined>(undefined);

  const handleJsonChange = React.useCallback(
    (value: unknown | undefined, errorMessage: string | null) => {
      setParsedPayload({ value, errorMessage });
    },
    [],
  );

  const canSubmit =
    parsedPayload.errorMessage === null &&
    typeof parsedPayload.value !== "undefined" &&
    rawPayload.trim().length > 0;

  const handleSubmitClick = React.useCallback(() => {
    if (busy) return;

    setError(undefined);
    setResult(undefined);

    if (!canSubmit) return;

    setBusy(true);
    void onSubmit(parsedPayload.value)
      .then((value) => {
        setResult(value);
      })
      .catch((caught) => {
        setError(caught);
      })
      .finally(() => {
        setBusy(false);
      });
  }, [busy, canSubmit, onSubmit, parsedPayload.value]);

  return (
    <div className="grid gap-4">
      <JsonWsPanelForm
        title={title}
        description={description}
        payloadLabel={payloadLabel}
        payloadTestId={payloadTestId}
        rawPayload={rawPayload}
        onRawPayloadChange={setRawPayload}
        onJsonChange={handleJsonChange}
        busy={busy}
        submitTestId={submitTestId}
        submitLabel={submitLabel}
        onSubmitClick={handleSubmitClick}
      />

      <ApiResultCard
        heading={resultHeading}
        value={result}
        error={error}
        data-testid={resultTestId}
      />
    </div>
  );
}
