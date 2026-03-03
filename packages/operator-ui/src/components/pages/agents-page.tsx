import type { OperatorCore } from "@tyrum/operator-core";
import { useState } from "react";
import { PageHeader } from "../layout/page-header.js";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";

export function AgentsPage({ core }: { core: OperatorCore }) {
  const [agentIdRaw, setAgentIdRaw] = useState("default");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<unknown>(undefined);

  const fetchStatus = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setResult(undefined);
    setError(undefined);
    try {
      const trimmed = agentIdRaw.trim();
      setResult(await core.http.agentStatus.get(trimmed ? { agent_id: trimmed } : undefined));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6" data-testid="agents-page">
      <PageHeader
        title="Agents"
        actions={
          <Button
            variant="secondary"
            isLoading={busy}
            data-testid="agents-refresh"
            onClick={() => {
              void fetchStatus();
            }}
          >
            Refresh
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <div className="text-sm font-medium text-fg">Agent status</div>
          <div className="text-sm text-fg-muted">
            Fetches the current gateway agent configuration for a given <code>agent_id</code>.
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Input
            label="Agent ID"
            placeholder="default"
            value={agentIdRaw}
            onChange={(e) => setAgentIdRaw(e.target.value)}
          />
          <ApiResultCard heading="Status" value={result} error={error} />
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="secondary"
            isLoading={busy}
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
