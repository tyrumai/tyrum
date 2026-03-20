import type { OperatorCore } from "@tyrum/operator-app";
import type { TranscriptSessionSummary } from "@tyrum/contracts";
import { FileText, GitBranch } from "lucide-react";
import { cn } from "../../lib/cn.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { EmptyState } from "../ui/empty-state.js";
import { LoadingState } from "../ui/loading-state.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Select } from "../ui/select.js";
import { formatSessionTitle, type AgentOption } from "./transcripts-page.lib.js";

export function TranscriptSidebar(props: {
  agentOptions: AgentOption[];
  channelOptions: string[];
  core: OperatorCore;
  loadingList: boolean;
  errorListMessage: string | null;
  sessionTreeEntries: Array<{ session: TranscriptSessionSummary; depth: number }>;
  nextCursor: string | null;
  selectedSessionKey: string | null;
  agentId: string | null;
  channel: string | null;
  activeOnly: boolean;
  archived: boolean;
  onSelectSession: (sessionKey: string) => void;
}) {
  const {
    agentOptions,
    channelOptions,
    core,
    loadingList,
    errorListMessage,
    sessionTreeEntries,
    nextCursor,
    selectedSessionKey,
    agentId,
    channel,
    activeOnly,
    archived,
    onSelectSession,
  } = props;

  return (
    <div className="min-h-0 border-b border-border lg:border-b-0 lg:border-r">
      <ScrollArea className="h-full">
        <div className="grid gap-4 p-4">
          <Alert
            variant="info"
            title="Retained transcript history"
            description="This view reflects retained AI SDK session history plus linked runs, approvals, and subagents. It is not an immutable audit log."
          />

          <div className="grid gap-3">
            <Select
              label="Agent"
              value={agentId ?? "all"}
              onChange={(event) => {
                core.transcriptStore.setAgentId(
                  event.target.value === "all" ? null : event.target.value,
                );
              }}
            >
              <option value="all">All agents</option>
              {agentOptions.map((agent) => (
                <option key={agent.agentKey} value={agent.agentKey}>
                  {agent.label}
                </option>
              ))}
            </Select>
            <Select
              label="Channel"
              value={channel ?? "all"}
              onChange={(event) => {
                core.transcriptStore.setChannel(
                  event.target.value === "all" ? null : event.target.value,
                );
              }}
            >
              <option value="all">All channels</option>
              {channelOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={activeOnly ? "secondary" : "outline"}
                onClick={() => {
                  core.transcriptStore.setActiveOnly(!activeOnly);
                }}
              >
                Active only
              </Button>
              <Button
                type="button"
                size="sm"
                variant={archived ? "secondary" : "outline"}
                onClick={() => {
                  core.transcriptStore.setArchived(!archived);
                }}
              >
                Archived
              </Button>
            </div>
          </div>

          {errorListMessage ? (
            <Alert
              variant="error"
              title="Transcript list unavailable"
              description={errorListMessage}
            />
          ) : null}

          {loadingList && sessionTreeEntries.length === 0 ? (
            <LoadingState variant="centered" label="Loading transcripts…" />
          ) : sessionTreeEntries.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No transcripts found"
              description="Adjust the filters or wait for agents to start new sessions."
            />
          ) : (
            <div className="grid gap-1" data-testid="transcript-session-list">
              {sessionTreeEntries.map(({ session, depth }) => {
                const selected = session.session_key === selectedSessionKey;
                return (
                  <button
                    key={session.session_key}
                    type="button"
                    className={cn(
                      "grid gap-1 rounded-lg border px-3 py-2 text-left transition-colors",
                      selected
                        ? "border-primary/60 bg-primary-dim/20"
                        : "border-transparent bg-bg hover:border-border hover:bg-bg-subtle/60",
                    )}
                    data-testid={`transcript-session-${session.session_key}`}
                    style={{ paddingLeft: `${12 + depth * 18}px` }}
                    onClick={() => {
                      onSelectSession(session.session_key);
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {depth > 0 ? (
                        <GitBranch className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
                      ) : null}
                      <span className="truncate text-sm font-medium text-fg">
                        {formatSessionTitle(session)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                      <span>{session.agent_id}</span>
                      <span>•</span>
                      <span>{session.message_count} messages</span>
                      {session.has_active_run ? <Badge variant="warning">active</Badge> : null}
                      {session.pending_approval_count > 0 ? (
                        <Badge variant="warning">{session.pending_approval_count} approvals</Badge>
                      ) : null}
                    </div>
                  </button>
                );
              })}
              {nextCursor ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loadingList}
                  isLoading={loadingList}
                  onClick={() => {
                    void core.transcriptStore.loadMore();
                  }}
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
