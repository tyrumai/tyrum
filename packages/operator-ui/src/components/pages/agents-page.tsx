import type { OperatorCore } from "@tyrum/operator-core";
import type { AgentStatusResponse } from "@tyrum/schemas";
import { Bot, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MemoryInspector } from "../memory/memory-inspector.js";
import { PageHeader } from "../layout/page-header.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { Alert } from "../ui/alert.js";
import { StatusDot } from "../ui/status-dot.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { RunsPage } from "./runs-page.js";
import { cn } from "../../lib/cn.js";
import { useOperatorStore } from "../../use-operator-store.js";
import {
  getActiveAgentIdsFromSessionLanes,
  parseAgentIdFromKey,
} from "../../lib/status-session-lanes.js";

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

function AgentIdentityPanel({
  loading,
  error,
  status,
  onRefresh,
}: {
  loading: boolean;
  error: string | null;
  status: AgentStatusResponse | null;
  onRefresh: () => void;
}) {
  if (error) {
    return <Alert variant="error" title="Failed to load agent" description={error} />;
  }

  if (loading && !status) {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-fg-muted">Loading agent identity…</CardContent>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-fg-muted">
          Select an agent to load its identity.
        </CardContent>
      </Card>
    );
  }

  const detailedSkills = status.skills_detailed ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-fg-muted">
          Identity, runtime model, tool access, memory support, and session policy for the selected
          agent.
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="agents-status-refresh"
          disabled={loading}
          isLoading={loading}
          onClick={onRefresh}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card data-testid="agents-identity-overview">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Overview</div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.enabled ? "success" : "outline"}>
                {status.enabled ? "Enabled" : "Disabled"}
              </Badge>
              {status.workspace_skills_trusted ? (
                <Badge variant="outline">Workspace skills trusted</Badge>
              ) : null}
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">Name</div>
              <div className="text-base font-medium text-fg">{status.identity.name}</div>
            </div>
            {status.identity.description ? (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Description
                </div>
                <div className="text-sm text-fg">{status.identity.description}</div>
              </div>
            ) : null}
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">Home</div>
              <code className="break-all rounded bg-bg-subtle px-2 py-1 text-xs text-fg">
                {status.home}
              </code>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="agents-identity-model">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Model</div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                Primary
              </div>
              <div className="text-base font-medium text-fg">{status.model.model}</div>
            </div>
            {status.model.variant ? (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Variant
                </div>
                <div className="text-sm text-fg">{status.model.variant}</div>
              </div>
            ) : null}
            {status.model.fallback && status.model.fallback.length > 0 ? (
              <div className="grid gap-2">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Fallbacks
                </div>
                <div className="flex flex-wrap gap-2">
                  {status.model.fallback.map((model) => (
                    <Badge key={model} variant="outline">
                      {model}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card data-testid="agents-identity-skills">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Skills</div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {status.skills.length === 0 ? (
              <div className="text-fg-muted">No skills configured.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {status.skills.map((skill) => (
                  <Badge key={skill} variant="outline">
                    {skill}
                  </Badge>
                ))}
              </div>
            )}
            {detailedSkills.length > 0 ? (
              <div className="grid gap-2">
                {detailedSkills.map((skill) => (
                  <div
                    key={skill.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-fg">
                        {skill.name} <span className="text-fg-muted">({skill.id})</span>
                      </div>
                      <div className="text-xs text-fg-muted">
                        {skill.source} • v{skill.version}
                      </div>
                    </div>
                    <Badge variant="outline">Installed</Badge>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card data-testid="agents-identity-tools">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Tools</div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {status.tools.length === 0 ? (
              <div className="text-fg-muted">No tools configured.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {status.tools.map((tool) => (
                  <Badge key={tool} variant="outline">
                    {tool}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="agents-identity-mcp">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">MCP</div>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {status.mcp.length === 0 ? (
              <div className="text-fg-muted">No MCP servers configured.</div>
            ) : (
              status.mcp.map((server) => (
                <div
                  key={server.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-fg">{server.name}</div>
                    <div className="text-xs text-fg-muted">
                      {server.id} • {server.transport}
                    </div>
                  </div>
                  <Badge variant={server.enabled ? "success" : "outline"}>
                    {server.enabled ? "On" : "Off"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card data-testid="agents-identity-sessions">
          <CardHeader className="pb-4">
            <div className="text-sm font-medium text-fg">Sessions</div>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border/70 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">TTL</div>
                <div className="text-base font-medium text-fg">{status.sessions.ttl_days} days</div>
              </div>
              <div className="rounded-lg border border-border/70 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Max turns
                </div>
                <div className="text-base font-medium text-fg">{status.sessions.max_turns}</div>
              </div>
              <div className="rounded-lg border border-border/70 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Context window
                </div>
                <div className="text-base font-medium text-fg">
                  {status.sessions.context_pruning.max_messages} messages
                </div>
              </div>
              <div className="rounded-lg border border-border/70 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Tool prune keep
                </div>
                <div className="text-base font-medium text-fg">
                  {status.sessions.context_pruning.tool_prune_keep_last_messages} messages
                </div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border/70 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Within-turn limits
                </div>
                <div className="text-fg">
                  {status.sessions.loop_detection.within_turn.consecutive_repeat_limit} consecutive
                  {" • "}
                  {status.sessions.loop_detection.within_turn.cycle_repeat_limit} cycle
                </div>
              </div>
              <div className="rounded-lg border border-border/70 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                  Cross-turn detection
                </div>
                <div className="text-fg">
                  {status.sessions.loop_detection.cross_turn.window_assistant_messages} msgs
                  {" • "}
                  {status.sessions.loop_detection.cross_turn.similarity_threshold} similarity
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
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
                className="flex h-10 w-full rounded-md border border-border bg-bg-card/40 px-3 py-2 text-sm text-fg shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
            className="flex h-10 w-full rounded-md border border-border bg-bg-card/40 px-3 py-2 text-sm text-fg shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
                      "grid gap-2 rounded-xl border px-3 py-3 text-left transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                      selected
                        ? "border-primary bg-primary-dim/20"
                        : "border-border/70 bg-bg-card/40 hover:bg-bg-card/60",
                    )}
                    onClick={() => {
                      setSelectionReady(true);
                      setSelectedAgentKey(agent.agentKey);
                    }}
                  >
                    <div className="font-medium text-fg">{agent.agentKey}</div>
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
            <Badge variant="outline" data-testid="agents-selected-key">
              {selectedAgentKey}
            </Badge>
            <div className="flex items-center gap-2 text-sm text-fg-muted">
              <StatusDot
                variant={activeAgentIds.has(selectedAgentKey) ? "success" : "neutral"}
                pulse={activeAgentIds.has(selectedAgentKey)}
              />
              {activeAgentIds.has(selectedAgentKey) ? "Currently active" : "Currently idle"}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="grid gap-4">
            <TabsList aria-label="Agent sections">
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
