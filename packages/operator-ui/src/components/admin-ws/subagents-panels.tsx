import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { JsonWsPanel } from "./json-ws-panel.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { JsonViewer } from "../ui/json-viewer.js";

type LoggedEvent = {
  type: string;
  occurred_at: string | null;
  data: unknown;
};

function SubagentEventLog({ core }: { core: OperatorCore }): React.ReactElement {
  const [events, setEvents] = React.useState<LoggedEvent[]>([]);

  React.useEffect(() => {
    const handler = (data: any): void => {
      const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
      const type = typeof record?.["type"] === "string" ? (record["type"] as string) : "unknown";
      const occurredAt =
        typeof record?.["occurred_at"] === "string" ? (record["occurred_at"] as string) : null;

      setEvents((prev) => [{ type, occurred_at: occurredAt, data }, ...prev].slice(0, 100));
    };

    const types = [
      "subagent.spawned",
      "subagent.updated",
      "subagent.closed",
      "subagent.output",
    ] as const;
    for (const t of types) core.ws.on(t, handler);

    return () => {
      for (const t of types) core.ws.off(t, handler);
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
