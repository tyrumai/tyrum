import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { optionalString, useApiAction } from "./admin-http-shared.js";

const DEFAULT_RESULT_VIEWER_PROPS = {
  defaultExpandedDepth: 1,
  contentClassName: "max-h-[420px]",
} as const;

export function AgentStatusPanel({ core }: { core: OperatorCore }) {
  const agentStatusApi = core.http.agentStatus;
  const [agentId, setAgentId] = React.useState("");
  const action = useApiAction<unknown>();
  const resolvedAgentId = optionalString(agentId);

  return (
    <Card data-testid="admin-http-agent-status-panel">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Agent Status</div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Input
          label="Agent id (optional)"
          placeholder="default"
          value={agentId}
          onChange={(event) => {
            setAgentId(event.target.value);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            isLoading={action.isLoading}
            onClick={() => {
              void action.run(() =>
                agentStatusApi.get(resolvedAgentId ? { agent_id: resolvedAgentId } : {}),
              );
            }}
          >
            Fetch
          </Button>
          <Button
            variant="secondary"
            disabled={action.isLoading}
            onClick={() => {
              action.reset();
            }}
          >
            Clear
          </Button>
        </div>
        <ApiResultCard
          heading="Agent status"
          value={action.value}
          error={action.error}
          jsonViewerProps={DEFAULT_RESULT_VIEWER_PROPS}
        />
      </CardContent>
    </Card>
  );
}
