import type { OperatorCore } from "@tyrum/operator-app";
import type { TranscriptConversationSummary } from "@tyrum/contracts";
import { Bot, Pencil, Square } from "lucide-react";
import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { cn } from "../../lib/cn.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { EmptyState } from "../ui/empty-state.js";
import { LoadingState } from "../ui/loading-state.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { StatusDot } from "../ui/status-dot.js";
import { AgentAvatar } from "./agents-page-agent-display.js";
import { AgentsPageCreateWizard } from "./agents-page-create-wizard.js";
import { AgentsPageEditor } from "./agents-page-editor.js";
import {
  buildChildConversationEntries,
  buildChildConversationsByParentKey,
  formatConversationCount,
  formatSubagentLabel,
  resolveActiveRootConversationKey,
  subagentStatusVariant,
  type EditorMode,
  type ManagedAgentOption,
} from "./agents-page.lib.js";

const AGENTS_INFO_DISMISSED_KEY = "tyrum:agents-info-dismissed";

export function AgentTreeRow(props: {
  agent: ManagedAgentOption;
  active: boolean;
  selected: boolean;
  conversationCount: number;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const { agent, active, selected, conversationCount, onSelect, onEdit } = props;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors",
        selected
          ? "border-primary/60 bg-primary-dim/20"
          : "border-transparent bg-bg hover:border-border hover:bg-bg-subtle/60",
      )}
    >
      <button
        type="button"
        data-testid={`agents-select-${agent.agentKey}`}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
        onClick={onSelect}
      >
        <AgentAvatar
          agentKey={agent.agentKey}
          displayName={agent.displayName}
          className="mt-0.5 h-8 w-8 text-sm"
          testId={`agents-avatar-${agent.agentKey}`}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg" title={agent.displayName}>
            {agent.displayName}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <StatusDot variant={active ? "success" : "neutral"} pulse={active} />
            <span>{active ? "Active" : "Idle"}</span>
            <span>•</span>
            <span>{formatConversationCount(conversationCount)}</span>
          </div>
        </div>
      </button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-testid={`agents-edit-${agent.agentKey}`}
        className="h-8 shrink-0 px-2"
        onClick={(event) => {
          event.stopPropagation();
          onEdit();
        }}
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>
    </div>
  );
}

export function SubagentTreeRow(props: {
  session: TranscriptConversationSummary;
  depth: number;
  selected: boolean;
  stopping: boolean;
  onSelect: () => void;
  onStop: () => void;
}) {
  const { session, depth, selected, stopping, onSelect, onStop } = props;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors",
        selected
          ? "border-primary/60 bg-primary-dim/20"
          : "border-transparent bg-bg hover:border-border hover:bg-bg-subtle/60",
      )}
      style={{ marginLeft: `${depth * 18}px` }}
    >
      <button
        type="button"
        data-testid={`agents-subagent-${session.conversation_key}`}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
        onClick={onSelect}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-subtle text-fg-muted">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg">{formatSubagentLabel(session)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            {session.subagent_status ? (
              <Badge variant={subagentStatusVariant(session.subagent_status)}>
                {session.subagent_status}
              </Badge>
            ) : null}
          </div>
        </div>
      </button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-testid={`agents-stop-${session.subagent_id ?? session.conversation_key}`}
        className="h-8 shrink-0 px-2 text-error hover:text-error"
        disabled={!session.subagent_id || stopping}
        isLoading={stopping}
        onClick={(event) => {
          event.stopPropagation();
          onStop();
        }}
      >
        <Square className="h-3.5 w-3.5 fill-current" />
        Stop
      </Button>
    </div>
  );
}

export function EmptyTimelinePanel(props: { title: string; description: string; testId: string }) {
  return (
    <div className="min-h-0 border-b border-border lg:border-b-0 lg:border-r">
      <ScrollArea className="h-full">
        <div className="grid gap-4 p-4" data-testid={props.testId}>
          <EmptyState icon={Bot} title={props.title} description={props.description} />
        </div>
      </ScrollArea>
    </div>
  );
}

export function AgentsPageEditorDialog(props: {
  core: OperatorCore;
  editorMode: EditorMode;
  createNonce: number;
  selectedAgentOption: ManagedAgentOption | null;
  deleteOpen: boolean;
  deleteLoading: boolean;
  onDeleteOpenChange: (open: boolean) => void;
  onDeleteConfirm: () => Promise<void>;
  onClose: () => void;
  onSaved: (agentKey: string) => void;
}) {
  const {
    core,
    editorMode,
    createNonce,
    selectedAgentOption,
    deleteOpen,
    deleteLoading,
    onDeleteOpenChange,
    onDeleteConfirm,
    onClose,
    onSaved,
  } = props;
  const editorDescription =
    editorMode === "create"
      ? "Create a managed agent and persist its configuration."
      : "Edit the selected managed agent in a focused dialog.";

  return (
    <>
      <ConfirmDangerDialog
        open={deleteOpen}
        onOpenChange={onDeleteOpenChange}
        title={selectedAgentOption ? `Delete ${selectedAgentOption.displayName}` : "Delete agent"}
        description="This permanently removes the managed agent configuration and identity history."
        confirmLabel="Delete agent"
        isLoading={deleteLoading}
        onConfirm={onDeleteConfirm}
      />

      <Dialog
        open={editorMode !== "closed"}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
      >
        <DialogContent
          className="max-w-[min(88rem,calc(100vw-2rem))]"
          data-testid="agents-editor-dialog"
        >
          <DialogHeader>
            <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
              <div className="grid gap-1">
                <DialogTitle>
                  {editorMode === "create"
                    ? "New managed agent"
                    : selectedAgentOption
                      ? `Edit ${selectedAgentOption.displayName}`
                      : "Edit managed agent"}
                </DialogTitle>
                <DialogDescription>{editorDescription}</DialogDescription>
              </div>
              {editorMode === "edit" && selectedAgentOption?.canDelete ? (
                <Button
                  type="button"
                  variant="danger"
                  data-testid="agents-delete"
                  onClick={() => {
                    onDeleteOpenChange(true);
                  }}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          </DialogHeader>
          <div className="mt-4">
            {editorMode === "create" ? (
              <AgentsPageCreateWizard core={core} onSaved={onSaved} onCancel={onClose} />
            ) : editorMode === "edit" ? (
              <AgentsPageEditor
                core={core}
                mode="edit"
                createNonce={createNonce}
                agentKey={selectedAgentOption?.agentKey}
                onSaved={onSaved}
                onCancelCreate={onClose}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AgentsPageSidebar(props: {
  scrollAreaRef: ComponentProps<typeof ScrollArea>["ref"];
  agentsError: string | null;
  transcriptErrorListMessage: string | null;
  agentsLoading: boolean;
  agentOptions: readonly ManagedAgentOption[];
  rootsByAgent: ReadonlyMap<string, readonly TranscriptConversationSummary[]>;
  activeAgentIds: ReadonlySet<string>;
  activeRootByAgentKey: Readonly<Record<string, string>>;
  sessionsByKey: ReadonlyMap<string, TranscriptConversationSummary>;
  selectedAgentKey: string;
  selectedSubagentSessionKey: string | null;
  stoppingSubagentId: string | null;
  stopActionLoading: boolean;
  nextCursor: string | null;
  transcriptLoadingList: boolean;
  onSelectAgent: (agentKey: string) => void;
  onEditAgent: (agentKey: string) => void;
  onSelectSubagent: (input: { agentKey: string; sessionKey: string }) => void;
  onStopSubagent: (input: { agentKey: string; session: TranscriptConversationSummary }) => void;
  onLoadMore: () => void;
}) {
  const {
    scrollAreaRef,
    agentsError,
    transcriptErrorListMessage,
    agentsLoading,
    agentOptions,
    rootsByAgent,
    activeAgentIds,
    activeRootByAgentKey,
    sessionsByKey,
    selectedAgentKey,
    selectedSubagentSessionKey,
    stoppingSubagentId,
    stopActionLoading,
    nextCursor,
    transcriptLoadingList,
    onSelectAgent,
    onEditAgent,
    onSelectSubagent,
    onStopSubagent,
    onLoadMore,
  } = props;

  const activeRootConversationKeyByAgent = useMemo(() => {
    const rootConversationKeyByAgent = new Map<string, string>();
    for (const agent of agentOptions) {
      const rootConversationKey = resolveActiveRootConversationKey({
        agentKey: agent.agentKey,
        activeRootByAgentKey,
        rootsByAgent,
      });
      if (rootConversationKey) {
        rootConversationKeyByAgent.set(agent.agentKey, rootConversationKey);
      }
    }
    return rootConversationKeyByAgent;
  }, [activeRootByAgentKey, agentOptions, rootsByAgent]);

  const childrenByParentKey = useMemo(
    () => buildChildConversationsByParentKey(sessionsByKey),
    [sessionsByKey],
  );
  const childEntriesByRootSessionKey = useMemo(() => {
    const childEntriesByRoot = new Map<
      string,
      Array<{ session: TranscriptConversationSummary; depth: number }>
    >();
    for (const rootConversationKey of activeRootConversationKeyByAgent.values()) {
      if (childEntriesByRoot.has(rootConversationKey)) {
        continue;
      }
      childEntriesByRoot.set(
        rootConversationKey,
        buildChildConversationEntries({
          rootConversationKey,
          childrenByParentKey,
        }),
      );
    }
    return childEntriesByRoot;
  }, [activeRootConversationKeyByAgent, childrenByParentKey]);

  const [agentsInfoDismissed, setAgentsInfoDismissed] = useState(() => {
    try {
      return localStorage.getItem(AGENTS_INFO_DISMISSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  const handleDismissAgentsInfo = useCallback(() => {
    setAgentsInfoDismissed(true);
    try {
      localStorage.setItem(AGENTS_INFO_DISMISSED_KEY, "true");
    } catch {
      // localStorage may be unavailable; dismiss in-memory only
    }
  }, []);

  return (
    <div
      className="min-h-0 border-b border-border lg:border-b-0 lg:border-r"
      data-testid="agents-list-panel"
    >
      <ScrollArea ref={scrollAreaRef} className="h-full">
        <div className="grid gap-4 p-4">
          {agentsInfoDismissed ? null : (
            <Alert
              variant="info"
              title="Managed agents"
              description="Selecting an agent opens its latest retained transcript lineage. Retained subagents stay indented underneath the agent."
              onDismiss={handleDismissAgentsInfo}
            />
          )}

          {agentsError ? (
            <Alert
              variant="error"
              title="Agent list unavailable"
              description={agentsError}
              data-testid="agents-list-error"
            />
          ) : null}

          {transcriptErrorListMessage ? (
            <Alert
              variant="error"
              title="Transcript list unavailable"
              description={transcriptErrorListMessage}
            />
          ) : null}

          {agentsLoading && agentOptions.length === 0 ? (
            <LoadingState
              label="Loading agents…"
              className="py-8"
              data-testid="agents-list-loading"
            />
          ) : agentOptions.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No managed agents"
              description="Create a managed agent to inspect retained transcript history."
            />
          ) : (
            <div className="grid gap-2">
              {agentOptions.map((agent) => {
                const roots = rootsByAgent.get(agent.agentKey) ?? [];
                const active =
                  activeAgentIds.has(agent.agentId) || activeAgentIds.has(agent.agentKey);
                const rootConversationKey =
                  activeRootConversationKeyByAgent.get(agent.agentKey) ?? null;
                const childEntries = rootConversationKey
                  ? (childEntriesByRootSessionKey.get(rootConversationKey) ?? [])
                  : [];
                const agentSelected =
                  agent.agentKey === selectedAgentKey && selectedSubagentSessionKey === null;

                return (
                  <div key={agent.agentKey} className="grid gap-1">
                    <AgentTreeRow
                      agent={agent}
                      active={active}
                      selected={agentSelected}
                      conversationCount={roots.length}
                      onSelect={() => {
                        onSelectAgent(agent.agentKey);
                      }}
                      onEdit={() => {
                        onEditAgent(agent.agentKey);
                      }}
                    />
                    {childEntries.map(({ session, depth }) => (
                      <SubagentTreeRow
                        key={session.conversation_key}
                        session={session}
                        depth={depth}
                        selected={session.conversation_key === selectedSubagentSessionKey}
                        stopping={session.subagent_id === stoppingSubagentId && stopActionLoading}
                        onSelect={() => {
                          onSelectSubagent({
                            agentKey: agent.agentKey,
                            sessionKey: session.conversation_key,
                          });
                        }}
                        onStop={() => {
                          onStopSubagent({ agentKey: agent.agentKey, session });
                        }}
                      />
                    ))}
                  </div>
                );
              })}

              {nextCursor ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={transcriptLoadingList}
                  isLoading={transcriptLoadingList}
                  onClick={onLoadMore}
                >
                  Load more
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
