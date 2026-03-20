import type { OperatorCore } from "@tyrum/operator-app";
import type { AgentStatusResponse } from "@tyrum/contracts";
import { Bot, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApiAction } from "../../hooks/use-api-action.js";
import {
  getActiveAgentIdsFromSessionLanes,
  resolveAgentIdForRun,
} from "../../lib/status-session-lanes.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { AppPageToolbar } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { EmptyState } from "../ui/empty-state.js";
import { LoadingState } from "../ui/loading-state.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { StatusDot } from "../ui/status-dot.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import {
  AgentAvatar,
  AgentListRow,
  AgentMobilePicker,
  type AgentOption,
} from "./agents-page-agent-display.js";
import { AgentsPageCreateWizard } from "./agents-page-create-wizard.js";
import { AgentIdentityPanel } from "./agents-page-identity.js";
import { AgentsPageEditor } from "./agents-page-editor.js";
import { normalizeAgentOptions } from "./agent-options.shared.js";
import { useReconnectScrollArea, useReconnectTabState } from "../../reconnect-ui-state.js";
type AgentsPageTab = "identity" | "editor";

function trimAgentKey(value: string): string {
  const trimmed = value.trim();
  return trimmed;
}

function selectInitialAgentKey(input: {
  currentAgentKey: string;
  availableAgents: AgentOption[];
}): string {
  const current = trimAgentKey(input.currentAgentKey);
  if (input.availableAgents.some((agent) => agent.agentKey === current)) return current;
  return (
    input.availableAgents.find((agent) => agent.isPrimary)?.agentKey ??
    input.availableAgents[0]?.agentKey ??
    current
  );
}

export function AgentsPage({
  core,
  onNavigate,
}: {
  core: OperatorCore;
  onNavigate?: (id: string) => void;
}) {
  const connection = useOperatorStore(core.connectionStore);
  const agentStatus = useOperatorStore(core.agentStatusStore);
  const runs = useOperatorStore(core.runsStore);
  const status = useOperatorStore(core.statusStore);

  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [selectedAgentKey, setSelectedAgentKey] = useState(trimAgentKey(agentStatus.agentKey));
  const [selectionReady, setSelectionReady] = useState(false);
  const [activeTab, setActiveTab] = useReconnectTabState<AgentsPageTab>("agents.tab", "identity");
  const [createMode, setCreateMode] = useState(false);
  const [createNonce, setCreateNonce] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const detailScrollAreaRef = useReconnectScrollArea(`agents:${activeTab}:detail`);

  const deleteAction = useApiAction<void>();
  const isConnected = connection.status === "connected";
  const agentKeys = useMemo(() => agentOptions.map((agent) => agent.agentKey), [agentOptions]);
  const selectedAgentOption = useMemo(
    () => agentOptions.find((agent) => agent.agentKey === selectedAgentKey) ?? null,
    [agentOptions, selectedAgentKey],
  );

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
      const response = await core.admin.agents.list();
      const nextAgents = normalizeAgentOptions(response.agents, ({ agentKey, personaName, source }) => ({
        agentKey,
        agentId: source.agent_id.trim(),
        displayName: personaName || agentKey,
        canDelete: source.can_delete,
        isPrimary: source.is_primary === true,
      }));
      setAgentOptions(nextAgents);
      const nextSelectedAgentKey = selectInitialAgentKey({
        currentAgentKey: preferredAgentKey ?? selectedAgentKey,
        availableAgents: nextAgents,
      });
      setSelectedAgentKey(nextSelectedAgentKey);
      setSelectionReady(nextAgents.length > 0);
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
        availableAgents: agentOptions,
      }),
    );
  }, [agentKeys, agentOptions]);

  useEffect(() => {
    if (!isConnected || !selectionReady) return;
    const normalized = trimAgentKey(selectedAgentKey);
    core.agentStatusStore.setAgentKey(normalized);
    void core.agentStatusStore.refresh();
  }, [core.agentStatusStore, isConnected, selectedAgentKey, selectionReady]);

  const openCreateEditor = () => {
    setCreateMode(true);
    setCreateNonce((current) => current + 1);
    setActiveTab("editor");
  };

  const renderEditor = createMode || selectedAgentOption !== null;
  const mobileToolbarActions = (
    <div className="flex flex-wrap items-center gap-2 lg:hidden">
      <AgentMobilePicker
        agentOptions={agentOptions}
        selectedAgentOption={selectedAgentOption}
        selectedAgentKey={selectedAgentKey}
        disabled={agentOptions.length === 0}
        onSelect={(agentKey) => {
          setCreateMode(false);
          setSelectionReady(true);
          setSelectedAgentKey(agentKey);
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-testid="agents-refresh-mobile"
        className="h-8 w-8 p-0 text-fg-muted hover:text-fg"
        disabled={!isConnected || agentsLoading}
        isLoading={agentsLoading}
        onClick={() => {
          void refreshAgentList();
        }}
        title="Refresh list"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-testid="agents-new-mobile"
        className="h-8 w-8 p-0 text-fg-muted hover:text-fg"
        disabled={!isConnected}
        onClick={() => {
          openCreateEditor();
        }}
        title="New agent"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg"
      data-testid="agents-page"
    >
      <AppPageToolbar
        actions={mobileToolbarActions}
        className="lg:hidden"
        data-testid="agents-mobile-toolbar"
      />

      <ConfirmDangerDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={selectedAgentOption ? `Delete ${selectedAgentOption.displayName}` : "Delete agent"}
        description="This permanently removes the managed agent configuration and identity history."
        confirmLabel="Delete agent"
        isLoading={deleteAction.isLoading}
        onConfirm={async () => {
          if (!selectedAgentOption) return;
          await deleteAction.runAndThrow(async () => {
            await core.admin.agents.delete(selectedAgentOption.agentKey);
          });
          setCreateMode(false);
          setActiveTab("identity");
          await refreshAgentList();
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          className="hidden h-full w-[clamp(220px,24vw,300px)] shrink-0 flex-col border-r border-border bg-bg-subtle/30 lg:flex"
          data-testid="agents-list-panel"
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
            <div className="text-sm font-medium text-fg">Managed agents</div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="agents-refresh"
                className="h-7 w-7 p-0 text-fg-muted hover:text-fg"
                disabled={!isConnected || agentsLoading}
                isLoading={agentsLoading}
                onClick={() => {
                  void refreshAgentList();
                }}
                title="Refresh list"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="agents-new"
                className="h-7 w-7 p-0 text-fg-muted hover:text-fg"
                disabled={!isConnected}
                onClick={() => {
                  openCreateEditor();
                }}
                title="New agent"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {agentsLoading && agentKeys.length === 0 ? (
              <LoadingState
                label="Loading agents…"
                className="p-4"
                data-testid="agents-list-loading"
              />
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
                      <AgentListRow
                        key={agent.agentKey}
                        agent={agent}
                        active={active}
                        selected={selected}
                        onSelect={() => {
                          setCreateMode(false);
                          setSelectionReady(true);
                          setSelectedAgentKey(agent.agentKey);
                        }}
                      />
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="agents-detail-pane">
          <div
            className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4"
            data-testid="agents-detail-header"
          >
            <div className="min-w-0 flex flex-wrap items-center gap-3">
              {selectedAgentOption ? (
                <>
                  <AgentAvatar
                    agentKey={selectedAgentOption.agentKey}
                    displayName={selectedAgentOption.displayName}
                    className="h-8 w-8 text-sm"
                    testId="agents-selected-avatar"
                  />
                  <div
                    data-testid="agents-selected-name"
                    className="min-w-0 truncate text-sm font-medium text-fg"
                  >
                    {selectedAgentOption.displayName}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-fg-muted">
                    <StatusDot
                      variant={selectedAgentActive ? "success" : "neutral"}
                      pulse={selectedAgentActive}
                    />
                    {selectedAgentActive ? "Currently active" : "Currently idle"}
                  </div>
                </>
              ) : (
                <div data-testid="agents-selected-name" className="text-sm text-fg-muted">
                  No agent selected
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="agents-open-transcripts"
                disabled={!isConnected || !selectedAgentOption || !onNavigate}
                onClick={() => {
                  if (!selectedAgentOption || !onNavigate) {
                    return;
                  }
                  core.transcriptStore.setAgentId(selectedAgentOption.agentKey);
                  core.transcriptStore.setChannel(null);
                  core.transcriptStore.setArchived(false);
                  core.transcriptStore.setActiveOnly(false);
                  onNavigate("transcripts");
                }}
              >
                View transcripts
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
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <ScrollArea ref={detailScrollAreaRef} className="h-full">
              <div
                className="grid box-border min-w-0 w-full gap-4 px-4 py-4 md:px-5 md:py-5"
                data-testid="agents-content-layout"
              >
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
                    setActiveTab(nextTab as AgentsPageTab);
                  }}
                  className="grid min-w-0 gap-4"
                >
                  <TabsList aria-label="Agent sections" className="flex-wrap">
                    <TabsTrigger value="identity" data-testid="agents-tab-identity">
                      Identity
                    </TabsTrigger>
                    <TabsTrigger value="editor" data-testid="agents-tab-editor">
                      Editor
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

                  <TabsContent value="editor" forceMount>
                    {renderEditor ? (
                      createMode ? (
                        <AgentsPageCreateWizard
                          core={core}
                          onSaved={(savedAgentKey) => {
                            setCreateMode(false);
                            setActiveTab("identity");
                            void refreshAgentList(savedAgentKey);
                          }}
                          onCancel={() => {
                            setCreateMode(false);
                            setActiveTab("identity");
                          }}
                        />
                      ) : (
                        <AgentsPageEditor
                          core={core}
                          mode="edit"
                          createNonce={createNonce}
                          agentKey={selectedAgentOption?.agentKey}
                          onSaved={(savedAgentKey) => {
                            setCreateMode(false);
                            setActiveTab("identity");
                            void refreshAgentList(savedAgentKey);
                          }}
                          onCancelCreate={() => {
                            setCreateMode(false);
                            setActiveTab("identity");
                          }}
                        />
                      )
                    ) : (
                      <Card data-testid="agents-editor-placeholder">
                        <CardContent className="py-10 text-sm text-fg-muted">
                          Select an agent or create a managed agent to configure it here.
                        </CardContent>
                      </Card>
                    )}
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
