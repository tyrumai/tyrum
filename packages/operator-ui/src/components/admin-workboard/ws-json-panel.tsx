import * as React from "react";
import { isRecord } from "../../utils/is-record.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { JsonTextarea } from "../ui/json-textarea.js";
import type { WorkScopeDraft, WorkScopeErrors } from "./work-scope-selector.js";

function normalizeScope(scope: WorkScopeDraft): {
  scope: WorkScopeDraft | null;
  errors: WorkScopeErrors;
} {
  const tenant_id = scope.tenant_id.trim();
  const agent_id = scope.agent_id.trim();
  const workspace_id = scope.workspace_id.trim();

  const errors: WorkScopeErrors = {};
  if (!tenant_id) errors.tenant_id = "Tenant ID is required";
  if (!agent_id) errors.agent_id = "Agent ID is required";
  if (!workspace_id) errors.workspace_id = "Workspace ID is required";

  if (Object.keys(errors).length > 0) return { scope: null, errors };
  return { scope: { tenant_id, agent_id, workspace_id }, errors: {} };
}

type ParsedPayload = { ok: true; value: Record<string, unknown> } | { ok: false; error: unknown };

function parsePayload(rawPayload: string): ParsedPayload {
  const trimmed = rawPayload.trim();
  if (!trimmed) return { ok: true, value: {} };

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) {
      return { ok: false, error: new Error("Payload must be a JSON object.") };
    }

    return { ok: true, value: parsed };
  } catch (error) {
    return { ok: false, error };
  }
}

async function runWsJsonPanelRequest<TResult>({
  busyRef,
  scope,
  rawPayload,
  onScopeErrors,
  run,
  setBusy,
  setValue,
  setError,
}: {
  busyRef: React.MutableRefObject<boolean>;
  scope: WorkScopeDraft;
  rawPayload: string;
  onScopeErrors: (errors: WorkScopeErrors) => void;
  run: (payload: Record<string, unknown>) => Promise<TResult>;
  setBusy: (busy: boolean) => void;
  setValue: (value: TResult | undefined) => void;
  setError: (error: unknown | undefined) => void;
}): Promise<void> {
  if (busyRef.current) return;

  const normalized = normalizeScope(scope);
  onScopeErrors(normalized.errors);
  if (!normalized.scope) return;

  const parsedPayload = parsePayload(rawPayload);
  if (!parsedPayload.ok) {
    setValue(undefined);
    setError(parsedPayload.error);
    return;
  }

  const payload: Record<string, unknown> = { ...parsedPayload.value, ...normalized.scope };

  setBusy(true);
  setValue(undefined);
  setError(undefined);
  try {
    const result = await run(payload);
    setValue(result);
  } catch (error) {
    setError(error);
  } finally {
    setBusy(false);
  }
}

export interface WsJsonPanelProps<TResult> {
  scope: WorkScopeDraft;
  onScopeErrors: (errors: WorkScopeErrors) => void;
  title: string;
  payloadTestId: string;
  runTestId: string;
  defaultPayload: unknown;
  run: (payload: Record<string, unknown>) => Promise<TResult>;
  renderResult?: (result: TResult) => React.ReactNode;
}

export function WsJsonPanel<TResult>({
  scope,
  onScopeErrors,
  title,
  payloadTestId,
  runTestId,
  defaultPayload,
  run,
  renderResult,
}: WsJsonPanelProps<TResult>): React.ReactElement {
  const [rawPayload, setRawPayload] = React.useState(() =>
    typeof defaultPayload === "undefined" ? "" : JSON.stringify(defaultPayload, null, 2),
  );
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(busy);
  busyRef.current = busy;
  const [value, setValue] = React.useState<TResult | undefined>(undefined);
  const [error, setError] = React.useState<unknown | undefined>(undefined);

  const runRequest = React.useCallback(
    () =>
      runWsJsonPanelRequest({
        busyRef,
        scope,
        rawPayload,
        onScopeErrors,
        run,
        setBusy,
        setValue,
        setError,
      }),
    [onScopeErrors, rawPayload, run, scope],
  );

  return (
    <Card data-testid={`admin-ws-panel-${title}`}>
      <CardHeader className="pb-4">
        <div className="text-sm font-medium text-fg">{title}</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <JsonTextarea
          value={rawPayload}
          label="Payload (JSON)"
          helperText="Operation-specific payload fields (WorkScope is provided separately)."
          data-testid={payloadTestId}
          onChange={(event) => {
            setRawPayload(event.target.value);
          }}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            data-testid={runTestId}
            disabled={busy}
            onClick={() => {
              void runRequest();
            }}
          >
            {busy ? "Running…" : "Run"}
          </Button>
        </div>

        {typeof value !== "undefined" && renderResult ? renderResult(value) : null}
        <ApiResultCard heading="Response" value={value} error={error} />
      </CardContent>
    </Card>
  );
}
