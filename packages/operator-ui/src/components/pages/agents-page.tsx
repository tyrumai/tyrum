import type { OperatorCore } from "@tyrum/operator-core";
import { useState } from "react";
import { PageHeader } from "../layout/page-header.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { useOperatorStore } from "../../use-operator-store.js";

export function AgentsPage({ core }: { core: OperatorCore }) {
  const agentStatus = useOperatorStore(core.agentStatusStore);
  const [agentKeyRaw, setAgentKeyRaw] = useState(agentStatus.agentKey || "default");

  const fetchStatus = async (): Promise<void> => {
    if (agentStatus.loading) return;
    const trimmed = agentKeyRaw.trim();
    setAgentKeyRaw(trimmed);
    core.agentStatusStore.setAgentKey(trimmed);
    await core.agentStatusStore.refresh();
  };

  return (
    <div className="grid gap-6" data-testid="agents-page">
      <PageHeader title="Agents" />

      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Agent status</div>
          <div className="text-sm text-fg-muted">
            Fetches the current gateway agent configuration for a given <code>agent_key</code>.
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Agent key"
            placeholder="default"
            value={agentKeyRaw}
            onChange={(e) => setAgentKeyRaw(e.target.value)}
          />
          <ApiResultCard heading="Status" value={agentStatus.status} error={agentStatus.error} />
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="secondary"
            isLoading={agentStatus.loading}
            data-testid="agents-status-fetch"
            onClick={() => {
              void fetchStatus();
            }}
          >
            Fetch status
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
