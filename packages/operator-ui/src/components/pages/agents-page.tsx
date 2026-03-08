import type { OperatorCore } from "@tyrum/operator-core";
import type { AgentStatusResponse } from "@tyrum/schemas";
import { Bot, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MemoryInspector } from "../memory/memory-inspector.js";
import { PageHeader } from "../layout/page-header.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { Alert } from "../ui/alert.js";
import { StatusDot } from "../ui/status-dot.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { RunsPage } from "./runs-page.js";
import { AgentIdentityPanel } from "./agents-page-identity.js";
import { cn } from "../../lib/cn.js";
import {
  getActiveAgentIdsFromSessionLanes,
  parseAgentIdFromKey,
} from "../../lib/status-session-lanes.js";
import { useOperatorStore } from "../../use-operator-store.js";

type AgentOption = {
  agentKey: string;
  agentId?: string;
};

function trimAgentKey(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "default";
}

function normalizeAgentOptions(
  input: Array<{ agent_key: string; agent_id?: string }>,
): AgentOption[] {
  const byKey = new Map<string, AgentOption>();
  for (const agent of input) {
    const trimmed = agent.agent_key.trim();
    if (!trimmed) continue;
    const normalizedAgentId = agent.agent_id?.trim() || undefined;
    const existing = byKey.get(trimmed);
    if (!existing || (!existing.agentId && normalizedAgentId)) {
      byKey.set(trimmed, {
        agentKey: trimmed,
        ...(normalizedAgentId ? { agentId: normalizedAgentId } : {}),
      });
    }
  }
  return [...byKey.values()].toSorted((a, b) => a.agentKey.localeCompare(b.agentKey));
}

function selectInitialAgentKey(input: {
  currentAgentKey: string;
  availableAgentKeys: string[];
}): string {
  const current = trimAgentKey(input.currentAgentKey);
  if (input.availableAgentKeys.includes(current)) return current;
  if (input.availableAgentKeys.includes("default")) return "default";
  return input.availableAgentKeys[0] ?? current;
}
export function AgentsPage({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const agentStatus = useOperatorStore(core.agentStatusStore);
  const runs = useOperatorStore(core.runsStore);
  const status = useOperatorStore(core.statusStore);

  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [selectedAgentKey, setSelectedAgentKey] = useState(trimAgentKey(agentStatus.agentKey));
  const [manualAgentKey, setManualAgentKey] = useState(trimAgentKey(agentStatus.agentKey));
  const [selectionReady, setSelectionReady] = useState(false);
  const [activeTab, setActiveTab] = useState("identity");

  const isConnected = connection.status === "connected";
  const agentKeys = useMemo(() => agentOptions.map((agent) => agent.agentKey), [agentOptions]);
  const selectedAgentOption = useMemo(
    () => agentOptions.find((agent) => agent.agentKey === selectedAgentKey) ?? null,
    [agentOptions, selectedAgentKey],
  );
  const selectedAgentScopeId = useMemo(
    () =>
      selectedAgentOption?.agentId ??
      (selectedAgentOption || agentsError ? selectedAgentKey : undefined),
    [agentsError, selectedAgentKey, selectedAgentOption],
  );

  const activeAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of Object.values(runs.runsById)) {
      if (run.status !== "queued" && run.status !== "running" && run.status !== "paused") continue;
      const agentId = parseAgentIdFromKey(run.key);
      if (!agentId) continue;
      ids.add(agentId);
    }
    for (const agentId of getActiveAgentIdsFromSessionLanes(status.status?.session_lanes)) {
      ids.add(agentId);
    }
    return ids;
  }, [runs.runsById, status.status?.session_lanes]);
  const selectedAgentActive = activeAgentIds.has(selectedAgentKey);

  const refreshAgentList = async (): Promise<void> => {
    if (!isConnected) return;
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const response = await core.http.agentList.get({ include_default: true });
      const nextAgents = normalizeAgentOptions(response.agents);
      const nextKeys = nextAgents.map((agent) => agent.agentKey);
      setAgentOptions(nextAgents);
      const nextSelectedAgentKey = selectInitialAgentKey({
        currentAgentKey: selectedAgentKey,
        availableAgentKeys: nextKeys,
      });
      setSelectedAgentKey(nextSelectedAgentKey);
      setSelectionReady(nextKeys.length > 0);
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : String(error));
      setSelectionReady(false);
    } finally {
      setAgentsLoading(false);
    }
  };

  useEffect(() => {
    if (!isConnected) return;
    void refreshAgentList();
  }, [isConnected]);

  useEffect(() => {
    if (agentKeys.length === 0) return;
    setSelectedAgentKey((prev) =>
      selectInitialAgentKey({
        currentAgentKey: prev,
        availableAgentKeys: agentKeys,
      }),
    );
  }, [agentKeys]);

  useEffect(() => {
    setManualAgentKey(selectedAgentKey);
  }, [selectedAgentKey]);

  useEffect(() => {
    if (!isConnected || !selectionReady) return;
    const normalized = trimAgentKey(selectedAgentKey);
    core.agentStatusStore.setAgentKey(normalized);
    void core.agentStatusStore.refresh();
  }, [core.agentStatusStore, isConnected, selectedAgentKey, selectionReady]);

  return (
    <div className="grid gap-6" data-testid="agents-page">
      <PageHeader
        title="Agents"
        actions={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="agents-refresh"
            disabled={!isConnected || agentsLoading}
            isLoading={agentsLoading}
            onClick={() => {
              void refreshAgentList();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh list
          </Button>
        }
      />

      {!isConnected ? (
        <Alert
          variant="warning"
          title="Not connected"
          description="Connect to the gateway to inspect agents."
        />
      ) : null}

      {agentsError ? (
        <Card data-testid="agents-list-error">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Agent list unavailable</div>
            <div className="text-sm text-fg-muted">{agentsError}</div>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="grid gap-2 text-sm">
              <span className="font-medium text-fg">Agent key</span>
              <input
                value={manualAgentKey}
                onChange={(event) => {
                  setManualAgentKey(event.currentTarget.value);
                }}
                className="flex h-10 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0"
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              data-testid="agents-select-apply"
              onClick={() => {
                setSelectionReady(true);
                setSelectedAgentKey(trimAgentKey(manualAgentKey));
              }}
            >
              Open agent
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="lg:hidden">
        <label className="grid gap-2 text-sm">
          <span className="font-medium text-fg">Selected agent</span>
          <select
            data-testid="agents-select"
            value={selectedAgentKey}
            disabled={agentOptions.length === 0}
            onChange={(event) => {
              setSelectionReady(true);
              setSelectedAgentKey(event.currentTarget.value);
            }}
            className="flex h-10 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0"
          >
            {agentOptions.length === 0 ? (
              <option value={selectedAgentKey}>{selectedAgentKey}</option>
            ) : (
              agentOptions.map((agent) => (
                <option key={agent.agentKey} value={agent.agentKey}>
                  {agent.agentKey}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="hidden lg:flex lg:min-h-[40rem] lg:flex-col">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Agents</div>
            <div className="text-sm text-fg-muted">
              Pick an agent to inspect identity, memory, and runs.
            </div>
          </CardHeader>
          <CardContent className="grid gap-2">
            {agentsLoading && agentKeys.length === 0 ? (
              <div className="text-sm text-fg-muted" data-testid="agents-list-loading">
                Loading agents…
              </div>
            ) : agentOptions.length === 0 ? (
              <EmptyState
                icon={Bot}
                title="No agents found"
                description="Agents appear here once the gateway can enumerate them."
              />
            ) : (
              agentOptions.map((agent) => {
                const active = activeAgentIds.has(agent.agentKey);
                const selected = agent.agentKey === selectedAgentKey;
                return (
                  <button
                    key={agent.agentKey}
                    type="button"
                    data-testid={`agents-select-${agent.agentKey}`}
                    data-active={selected ? "true" : undefined}
                    className={cn(
                      "grid gap-2 rounded-md border px-3 py-3 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
                      selected
                        ? "border-primary bg-bg text-fg"
                        : "border-border bg-bg hover:bg-bg-subtle",
                    )}
                    onClick={() => {
                      setSelectionReady(true);
                      setSelectedAgentKey(agent.agentKey);
                    }}
                  >
                    <div className="break-all font-medium text-fg">{agent.agentKey}</div>
                    <div className="flex items-center gap-2 text-xs text-fg-muted">
                      <StatusDot variant={active ? "success" : "neutral"} pulse={active} />
                      {active ? "Active" : "Idle"}
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div
              data-testid="agents-selected-key"
              className="max-w-full rounded-md border border-border bg-bg-subtle px-2 py-1 font-mono text-xs text-fg break-all"
            >
              {selectedAgentKey}
            </div>
            <div className="flex items-center gap-2 text-sm text-fg-muted">
              <StatusDot
                variant={selectedAgentActive ? "success" : "neutral"}
                pulse={selectedAgentActive}
              />
              {selectedAgentActive ? "Currently active" : "Currently idle"}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="grid gap-4">
            <TabsList aria-label="Agent sections" className="flex-wrap">
              <TabsTrigger value="identity" data-testid="agents-tab-identity">
                Identity
              </TabsTrigger>
              <TabsTrigger value="memory" data-testid="agents-tab-memory">
                Memory
              </TabsTrigger>
              <TabsTrigger value="runs" data-testid="agents-tab-runs">
                Runs
              </TabsTrigger>
            </TabsList>

            <TabsContent value="identity">
              <AgentIdentityPanel
                loading={agentStatus.loading}
                error={agentStatus.error}
                status={agentStatus.status as AgentStatusResponse | null}
                onRefresh={() => {
                  void core.agentStatusStore.refresh();
                }}
              />
            </TabsContent>

            <TabsContent value="memory">
              {selectedAgentScopeId ? (
                <MemoryInspector core={core} agentId={selectedAgentScopeId} />
              ) : (
                <Card data-testid="agents-memory-resolving">
                  <CardContent className="py-10 text-sm text-fg-muted">
                    Resolving agent memory scope…
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="runs">
              <RunsPage core={core} agentId={selectedAgentKey} hideHeader={true} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
