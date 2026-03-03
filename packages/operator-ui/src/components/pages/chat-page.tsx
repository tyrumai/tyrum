import type { OperatorCore } from "@tyrum/operator-core";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Separator } from "../ui/separator.js";
import { Textarea } from "../ui/textarea.js";

function firstLine(text: string): string {
  return text.split(/\r?\n/)[0]?.trim() ?? "";
}

function deriveThreadTitle(session: {
  thread_id: string;
  last_turn?: { role: string; content: string } | undefined;
}): string {
  const last = session.last_turn;
  if (last?.role === "user") {
    const line = firstLine(last.content);
    if (line) return line;
  }
  return session.thread_id;
}

export function ChatPage({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const isConnected = connection.status === "connected";
  const chat = useOperatorStore(core.chatStore);

  const [draft, setDraft] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const threads = useMemo(() => {
    return chat.sessions.sessions.map((session) => ({
      ...session,
      title: deriveThreadTitle(session),
      preview: session.last_turn ? firstLine(session.last_turn.content) : session.summary,
    }));
  }, [chat.sessions.sessions]);

  useEffect(() => {
    if (!isConnected) return;
    void core.chatStore.refreshAgents();
  }, [core.chatStore, isConnected]);

  useEffect(() => {
    if (!isConnected) return;
    void core.chatStore.refreshSessions();
  }, [core.chatStore, isConnected, chat.agentId]);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text) return;
    await core.chatStore.sendMessage(text);
    if (!core.chatStore.getSnapshot().send.error) {
      setDraft("");
    }
  };

  const active = chat.active.session;
  const activeTurns = active?.turns ?? [];

  return (
    <div className="grid gap-6" data-testid="chat-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Chat</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            data-testid="chat-agent-select"
            aria-label="Agent"
            value={chat.agentId}
            disabled={!isConnected || chat.agents.loading}
            onChange={(event) => {
              core.chatStore.setAgentId(event.currentTarget.value);
            }}
            className="flex h-9 min-w-56 rounded-md border border-border bg-bg-card/40 px-3 py-1 text-sm text-fg shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {chat.agents.agents.length === 0 ? (
              <option value={chat.agentId}>{chat.agentId}</option>
            ) : (
              chat.agents.agents.map((agent) => (
                <option key={agent.agent_id} value={agent.agent_id}>
                  {agent.agent_id}
                </option>
              ))
            )}
          </select>
          <Button
            size="sm"
            data-testid="chat-new"
            disabled={!isConnected}
            onClick={() => {
              void core.chatStore.newChat();
            }}
          >
            New chat
          </Button>
        </div>
      </div>

      {chat.agents.error ? (
        <Alert
          variant="error"
          title="Failed to load agents"
          description={chat.agents.error.message}
        />
      ) : null}

      <div className="grid gap-6 md:grid-cols-[320px_1fr]">
        <Card className="flex min-h-[32rem] flex-col">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-fg-muted">Threads</div>
              <Button
                size="sm"
                variant="secondary"
                data-testid="chat-refresh-sessions"
                disabled={!isConnected || chat.sessions.loading}
                onClick={() => {
                  void core.chatStore.refreshSessions();
                }}
              >
                Refresh
              </Button>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="flex-1 overflow-hidden">
            {chat.sessions.error ? (
              <Alert
                variant="error"
                title="Failed to load sessions"
                description={chat.sessions.error.message}
              />
            ) : null}
            {chat.sessions.loading && threads.length === 0 ? (
              <div className="text-sm text-fg-muted">Loading…</div>
            ) : threads.length === 0 ? (
              <div className="text-sm text-fg-muted">No chats yet.</div>
            ) : (
              <ScrollArea className="h-full">
                <div className="grid gap-2 pr-3">
                  {threads.map((session) => {
                    const isActive = chat.active.sessionId === session.session_id;
                    return (
                      <button
                        key={session.session_id}
                        type="button"
                        data-testid={`chat-thread-${session.session_id}`}
                        data-active={isActive ? "true" : undefined}
                        className={cn(
                          "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                          isActive
                            ? "border-border bg-bg-subtle/80"
                            : "border-border/50 bg-bg-card/40 hover:bg-bg-card/60",
                        )}
                        onClick={() => {
                          void core.chatStore.openSession(session.session_id);
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-fg">
                              {session.title}
                            </div>
                            <div className="mt-1 truncate text-xs text-fg-muted">
                              {session.preview || "—"}
                            </div>
                          </div>
                          <div className="shrink-0 text-xs text-fg-muted">
                            {formatRelativeTime(session.updated_at)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
          <CardFooter className="justify-between gap-2">
            <Button
              size="sm"
              variant="secondary"
              data-testid="chat-load-more"
              disabled={!chat.sessions.nextCursor || chat.sessions.loading}
              onClick={() => {
                void core.chatStore.loadMoreSessions();
              }}
            >
              Load more
            </Button>
            <div className="text-xs text-fg-muted">{threads.length} threads</div>
          </CardFooter>
        </Card>

        <Card className="flex min-h-[32rem] flex-col">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-fg">Conversation</div>
                <div className="mt-1 truncate text-xs text-fg-muted">
                  {active ? active.thread_id : "Select a thread to view transcript."}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="chat-compact"
                  disabled={!active || chat.active.loading}
                  onClick={() => {
                    void core.chatStore.compactActive();
                  }}
                >
                  Compact
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  data-testid="chat-delete"
                  disabled={!active || chat.active.loading}
                  onClick={() => {
                    setDeleteOpen(true);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="flex-1 overflow-hidden">
            {chat.active.error ? (
              <Alert
                variant="error"
                title="Failed to load transcript"
                description={chat.active.error.message}
              />
            ) : null}
            <ScrollArea className="h-full" data-testid="chat-transcript">
              <div className="grid gap-3 pr-3">
                {activeTurns.length === 0 ? (
                  <div className="text-sm text-fg-muted">
                    {active ? "No messages yet." : "Pick a thread or start a new chat."}
                  </div>
                ) : (
                  activeTurns.map((turn, index) => {
                    const isUser = turn.role === "user";
                    return (
                      <div
                        key={`${turn.role}-${index}`}
                        className={cn("flex", isUser ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] rounded-2xl border px-4 py-3 text-sm whitespace-pre-wrap",
                            isUser
                              ? "border-border bg-bg-subtle/80 text-fg"
                              : "border-border/50 bg-bg-card/40 text-fg",
                          )}
                        >
                          {turn.content}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
          <Separator />
          <CardFooter className="flex-col items-stretch gap-3">
            {chat.send.error ? (
              <Alert variant="error" title="Failed to send" description={chat.send.error.message} />
            ) : null}
            <Textarea
              data-testid="chat-composer"
              aria-label="Message"
              placeholder={active ? "Type a message…" : "Select a thread first."}
              value={draft}
              disabled={!active || chat.send.sending}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                if (event.shiftKey) return;
                event.preventDefault();
                void send();
              }}
              className="min-h-24"
            />
            <div className="flex items-center justify-end">
              <Button
                data-testid="chat-send"
                disabled={!active || chat.send.sending || draft.trim().length === 0}
                isLoading={chat.send.sending}
                onClick={() => {
                  void send();
                }}
              >
                Send
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>

      <ConfirmDangerDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this chat?"
        description="This removes the session transcript and clears any related overrides. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          await core.chatStore.deleteActive();
        }}
      />
    </div>
  );
}
