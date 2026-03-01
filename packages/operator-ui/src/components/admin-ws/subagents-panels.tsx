import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { JsonTextarea } from "../ui/json-textarea.js";
import { Label } from "../ui/label.js";
import { JsonViewer } from "../ui/json-viewer.js";

function parseJsonPayload(rawValue: string): {
  value: unknown | undefined;
  errorMessage: string | null;
} {
  const trimmed = rawValue.trim();
  if (!trimmed) return { value: undefined, errorMessage: null };

  try {
    return { value: JSON.parse(trimmed) as unknown, errorMessage: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { value: undefined, errorMessage: message };
  }
}

type JsonWsPanelProps = {
  title: string;
  description?: string;
  payloadLabel?: string;
  initialPayload: unknown;
  submitLabel?: string;
  resultHeading?: string;
  payloadTestId: string;
  submitTestId: string;
  onSubmit: (payload: unknown) => Promise<unknown>;
};

function JsonWsPanel({
  title,
  description,
  payloadLabel = "Payload (JSON)",
  initialPayload,
  submitLabel = "Send",
  resultHeading,
  payloadTestId,
  submitTestId,
  onSubmit,
}: JsonWsPanelProps): React.ReactElement {
  const [rawPayload, setRawPayload] = React.useState(() => JSON.stringify(initialPayload, null, 2));
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<unknown | undefined>(undefined);
  const [error, setError] = React.useState<unknown | undefined>(undefined);

  const parsedPayload = React.useMemo(() => parseJsonPayload(rawPayload), [rawPayload]);
  const canSubmit =
    !busy &&
    parsedPayload.errorMessage === null &&
    typeof parsedPayload.value !== "undefined" &&
    rawPayload.trim().length > 0;

  return (
    <div className="grid gap-4">
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
              onChange={(event) => {
                setRawPayload(event.target.value);
              }}
            />
          </div>
        </CardContent>

        <CardFooter>
          <Button
            type="button"
            data-testid={submitTestId}
            isLoading={busy}
            disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit) return;

              setBusy(true);
              setError(undefined);
              setResult(undefined);
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
            }}
          >
            {submitLabel}
          </Button>
        </CardFooter>
      </Card>

      <ApiResultCard heading={resultHeading} value={result} error={error} />
    </div>
  );
}

type LoggedEvent = {
  type: string;
  occurred_at: string | null;
  data: unknown;
};

function SubagentEventLog({ core }: { core: OperatorCore }): React.ReactElement {
  const [events, setEvents] = React.useState<LoggedEvent[]>([]);

  React.useEffect(() => {
    const handler = (data: unknown): void => {
      const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
      const type = typeof record?.["type"] === "string" ? (record["type"] as string) : "unknown";
      const occurredAt =
        typeof record?.["occurred_at"] === "string" ? (record["occurred_at"] as string) : null;

      setEvents((prev) => [{ type, occurred_at: occurredAt, data }, ...prev].slice(0, 100));
    };

    const types = ["subagent.spawned", "subagent.updated", "subagent.closed", "subagent.output"];
    for (const t of types) core.ws.on(t, handler as never);

    return () => {
      for (const t of types) core.ws.off(t, handler as never);
    };
  }, [core.ws]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="text-sm font-medium text-fg">Subagent events</div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setEvents([]);
          }}
        >
          Clear
        </Button>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="text-sm text-fg-muted">
            Event log is empty. Spawn/send subagents to see events here.
          </div>
        ) : (
          <JsonViewer value={events} defaultExpandedDepth={3} contentClassName="max-h-[420px]" />
        )}
      </CardContent>
    </Card>
  );
}

export function SubagentsPanels({ core }: { core: OperatorCore }): React.ReactElement {
  const scope = { tenant_id: "default", agent_id: "default", workspace_id: "default" } as const;
  const subagentId = "123e4567-e89b-12d3-a456-426614174222";

  return (
    <div className="grid gap-6" data-testid="admin-ws-subagents">
      <section className="grid gap-4" aria-label="Subagent operations">
        <div className="text-sm font-medium text-fg">Subagents</div>
        <div className="grid gap-4">
          <JsonWsPanel
            title="subagent.spawn"
            description="Spawn a new subagent runtime session."
            initialPayload={{ ...scope, execution_profile: "default" }}
            submitLabel="Spawn"
            resultHeading="subagent.spawn result"
            payloadTestId="admin-ws-subagent-spawn-payload"
            submitTestId="admin-ws-subagent-spawn-submit"
            onSubmit={(payload) => core.ws.subagentSpawn(payload as never) as Promise<unknown>}
          />

          <JsonWsPanel
            title="subagent.list"
            description="List subagents scoped to a tenant/agent/workspace."
            initialPayload={{ ...scope, statuses: ["running"], limit: 20 }}
            submitLabel="List"
            resultHeading="subagent.list result"
            payloadTestId="admin-ws-subagent-list-payload"
            submitTestId="admin-ws-subagent-list-submit"
            onSubmit={(payload) => core.ws.subagentList(payload as never) as Promise<unknown>}
          />

          <JsonWsPanel
            title="subagent.get"
            description="Fetch a single subagent descriptor."
            initialPayload={{ ...scope, subagent_id: subagentId }}
            submitLabel="Get"
            resultHeading="subagent.get result"
            payloadTestId="admin-ws-subagent-get-payload"
            submitTestId="admin-ws-subagent-get-submit"
            onSubmit={(payload) => core.ws.subagentGet(payload as never) as Promise<unknown>}
          />

          <JsonWsPanel
            title="subagent.send"
            description="Send a single message to a running subagent."
            initialPayload={{ ...scope, subagent_id: subagentId, content: "Hello" }}
            submitLabel="Send"
            resultHeading="subagent.send result"
            payloadTestId="admin-ws-subagent-send-payload"
            submitTestId="admin-ws-subagent-send-submit"
            onSubmit={(payload) => core.ws.subagentSend(payload as never) as Promise<unknown>}
          />

          <JsonWsPanel
            title="subagent.close"
            description="Close a subagent. Idempotent for already closed/failed subagents."
            initialPayload={{ ...scope, subagent_id: subagentId, reason: "done" }}
            submitLabel="Close"
            resultHeading="subagent.close result"
            payloadTestId="admin-ws-subagent-close-payload"
            submitTestId="admin-ws-subagent-close-submit"
            onSubmit={(payload) => core.ws.subagentClose(payload as never) as Promise<unknown>}
          />
        </div>
      </section>

      <SubagentEventLog core={core} />
    </div>
  );
}
