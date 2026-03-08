import type { OperatorCore } from "@tyrum/operator-core";
import type { AgentStatusResponse } from "@tyrum/schemas";
import { Bot, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApiAction } from "../../hooks/use-api-action.js";
import { cn } from "../../lib/cn.js";
import {
  getActiveAgentIdsFromSessionLanes,
  resolveAgentIdForRun,
} from "../../lib/status-session-lanes.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { AppPageToolbar } from "../layout/app-page.js";
import { MemoryInspector } from "../memory/memory-inspector.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { EmptyState } from "../ui/empty-state.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { StatusDot } from "../ui/status-dot.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { AgentIdentityPanel } from "./agents-page-identity.js";
import { AgentsPageEditor } from "./agents-page-editor.js";
import { RunsPage } from "./runs-page.js";

type AgentOption = {
  agentKey: string;
  agentId: string;
  canDelete: boolean;
};

function trimAgentKey(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "default";
}

function normalizeAgentOptions(
  input: Array<{ agent_key: string; agent_id: string; can_delete: boolean }>,
): AgentOption[] {
  return input.map((agent) => ({
    agentKey: agent.agent_key,
    agentId: agent.agent_id,
    canDelete: agent.can_delete,
  }));
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
  const [selectionReady, setSelectionReady] = useState(false);
  const [activeTab, setActiveTab] = useState("identity");
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [createNonce, setCreateNonce] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const deleteAction = useApiAction<void>();
  const isConnected = connection.status === "connected";
  const agentKeys = useMemo(() => agentOptions.map((agent) => agent.agentKey), [agentOptions]);
  const selectedAgentOption = useMemo(
    () => agentOptions.find((agent) => agent.agentKey === selectedAgentKey) ?? null,
    [agentOptions, selectedAgentKey],
  );
  const selectedAgentScopeId = selectedAgentOption?.agentId;

  const activeAgentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of Object.values(runs.runsById)) {
      if (run.status !== "queued" && run.status !== "running" && run.status !== "paused") continue;
      const agentId = resolveAgentIdForRun(run, runs.agentKeyByRunId);
      if (!agentId) continue;
      ids.add(agentId);
    }
    for (const agentId of getActiveAgentIdsFromSessionLanes(status.status?.session_lanes)) {
      ids.add(agentId);
    }
    return ids;
  }, [runs.agentKeyByRunId, runs.runsById, status.status?.session_lanes]);
  const selectedAgentActive = selectedAgentOption
    ? activeAgentIds.has(selectedAgentOption.agentId) || activeAgentIds.has(selectedAgentKey)
    : false;

  const refreshAgentList = async (preferredAgentKey?: string): Promise<void> => {
    if (!isConnected) return;
    setAgentsLoading(true);
    setAgentsError(null);
    try {
      const response = await core.http.agents.list();
      const nextAgents = normalizeAgentOptions(response.agents);
      const nextKeys = nextAgents.map((agent) => agent.agentKey);
      setAgentOptions(nextAgents);
      const nextSelectedAgentKey = selectInitialAgentKey({
        currentAgentKey: preferredAgentKey ?? selectedAgentKey,
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
    if (!isConnected || !selectionReady) return;
    const normalized = trimAgentKey(selectedAgentKey);
    core.agentStatusStore.setAgentKey(normalized);
    void core.agentStatusStore.refresh();
  }, [core.agentStatusStore, isConnected, selectedAgentKey, selectionReady]);

  const renderEditor = activeTab === "editor";
  const toolbarActions = (
    <div className="flex flex-wrap items-center gap-2">
      <select
        data-testid="agents-select"
        aria-label="Selected agent"
        value={selectedAgentKey}
        disabled={agentOptions.length === 0}
        onChange={(event) => {
          setSelectionReady(true);
          setSelectedAgentKey(event.currentTarget.value);
        }}
        className="flex h-8 w-[11rem] rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0 lg:hidden"
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
      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-testid="agents-new"
        disabled={!isConnected}
        onClick={() => {
          setEditorMode("create");
          setCreateNonce((current) => current + 1);
          setActiveTab("editor");
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        New agent
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-testid="agents-edit"
        disabled={!isConnected || !selectedAgentOption}
        onClick={() => {
          setEditorMode("edit");
          setActiveTab("editor");
        }}
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>
      <Button
        type="button"
        size="sm"
        variant="danger"
        data-testid="agents-delete"
        disabled={!isConnected || !selectedAgentOption?.canDelete}
        onClick={() => {
          setDeleteOpen(true);
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </Button>
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
    </div>
  );

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg"
      data-testid="agents-page"
    >
      <AppPageToolbar title="Agents" actions={toolbarActions} />

      <ConfirmDangerDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete agent ${selectedAgentKey}`}
        description="This permanently removes the managed agent configuration and identity history."
        confirmLabel="Delete agent"
        isLoading={deleteAction.isLoading}
        onConfirm={async () => {
          if (!selectedAgentOption) return;
          await deleteAction.runAndThrow(async () => {
            await core.http.agents.delete(selectedAgentOption.agentKey);
          });
          setEditorMode(null);
          setActiveTab("identity");
          await refreshAgentList();
        }}
      />

      <div className="flex min-h-0 flex-1">
        <div
          className="hidden h-full w-[260px] shrink-0 flex-col border-r border-border bg-bg-subtle/30 lg:flex"
          data-testid="agents-list-panel"
        >
          <div className="flex h-14 shrink-0 items-center border-b border-border px-3">
            <div className="text-sm font-medium text-fg">Managed agents</div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {agentsLoading && agentKeys.length === 0 ? (
              <div className="p-4 text-sm text-fg-muted" data-testid="agents-list-loading">
                Loading agents…
              </div>
            ) : agentOptions.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  icon={Bot}
                  title="No managed agents"
                  description="Create an agent to persist configuration and identity."
                />
              </div>
            ) : (
              <ScrollArea className="h-full">
                <div className="grid gap-1 p-2">
                  {agentOptions.map((agent) => {
                    const active =
                      activeAgentIds.has(agent.agentId) || activeAgentIds.has(agent.agentKey);
                    const selected = agent.agentKey === selectedAgentKey;
                    return (
                      <button
                        key={agent.agentKey}
                        type="button"
                        data-testid={`agents-select-${agent.agentKey}`}
                        data-active={selected ? "true" : undefined}
                        className={cn(
                          "grid gap-1.5 rounded-md px-2.5 py-2 text-left transition-colors duration-150",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
                          selected
                            ? "bg-bg-subtle text-fg"
                            : "bg-transparent text-fg-muted hover:bg-bg-subtle hover:text-fg",
                        )}
                        onClick={() => {
                          setSelectionReady(true);
                          setSelectedAgentKey(agent.agentKey);
                        }}
                      >
                        <div className="break-all text-sm font-medium">{agent.agentKey}</div>
                        <div className="flex items-center gap-2 text-xs opacity-80">
                          <StatusDot variant={active ? "success" : "neutral"} pulse={active} />
                          {active ? "Active" : "Idle"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
            <div className="min-w-0 flex flex-wrap items-center gap-3">
              <div
                data-testid="agents-selected-key"
                className="max-w-full rounded-md border border-border bg-bg-subtle px-2 py-1 font-mono text-xs text-fg break-all"
              >
                {selectedAgentOption?.agentKey ?? "No agent selected"}
              </div>
              <div className="flex items-center gap-2 text-sm text-fg-muted">
                <StatusDot
                  variant={selectedAgentActive ? "success" : "neutral"}
                  pulse={selectedAgentActive}
                />
                {selectedAgentActive ? "Currently active" : "Currently idle"}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-4 md:px-5 md:py-5">
                {!isConnected ? (
                  <Alert
                    variant="warning"
                    title="Not connected"
                    description="Connect to the gateway to inspect agents."
                  />
                ) : null}

                {agentsError ? (
                  <Alert
                    variant="error"
                    title="Agent list unavailable"
                    description={agentsError}
                    data-testid="agents-list-error"
                  />
                ) : null}

                <Tabs
                  value={activeTab}
                  onValueChange={(nextTab) => {
                    setActiveTab(nextTab);
                  }}
                  className="grid gap-4"
                >
                  <TabsList aria-label="Agent sections" className="flex-wrap">
                    <TabsTrigger value="identity" data-testid="agents-tab-identity">
                      Identity
                    </TabsTrigger>
                    <TabsTrigger value="editor" data-testid="agents-tab-editor">
                      Editor
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

                  <TabsContent value="editor">
                    {renderEditor && editorMode ? (
                      <AgentsPageEditor
                        core={core}
                        mode={editorMode}
                        createNonce={createNonce}
                        agentKey={editorMode === "edit" ? selectedAgentOption?.agentKey : undefined}
                        onSaved={(savedAgentKey) => {
                          setEditorMode(null);
                          setActiveTab("identity");
                          void refreshAgentList(savedAgentKey);
                        }}
                        onCancelCreate={() => {
                          setEditorMode(null);
                          setActiveTab("identity");
                        }}
                      />
                    ) : (
                      <Card data-testid="agents-editor-placeholder">
                        <CardContent className="py-10 text-sm text-fg-muted">
                          Choose Edit for the selected agent or New agent to create a managed agent.
                        </CardContent>
                      </Card>
                    )}
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
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  );
}
