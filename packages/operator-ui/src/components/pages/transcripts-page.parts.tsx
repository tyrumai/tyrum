import type {
  Approval,
  TranscriptApprovalEvent,
  TranscriptContextReportEvent,
  TranscriptConversationSummary,
  TranscriptSubagentEvent,
  TranscriptTimelineEvent,
  TranscriptToolLifecycleEvent,
  TranscriptTurnEvent,
} from "@tyrum/contracts";
import { Bot, Brain, FileText, GitBranch, ShieldCheck, Wrench, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { LoadingState } from "../ui/loading-state.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { StructuredValue } from "../ui/structured-value.js";
import { MessageCard } from "./chat-page-ai-sdk-message-card.js";
import {
  approvalStatusVariant,
  eventKindLabel,
  formatConversationTitle,
  contextReportSummary,
  TIMELINE_KINDS,
  toolLifecycleStatusVariant,
  turnStatusVariant,
  subagentPhaseVariant,
  toRenderableMessage,
  type InspectorField,
  type TimelineKindFilters,
} from "./transcripts-page.lib.js";

function eventKindIcon(kind: TranscriptTimelineEvent["kind"]) {
  switch (kind) {
    case "message":
      return FileText;
    case "turn":
      return Workflow;
    case "approval":
      return ShieldCheck;
    case "subagent":
      return GitBranch;
    case "tool_lifecycle":
      return Wrench;
    case "context_report":
      return Brain;
  }
  return FileText;
}

function EventChrome({
  children,
  event,
  conversation,
  selected,
  onSelect,
}: {
  children: ReactNode;
  event: TranscriptTimelineEvent;
  conversation: TranscriptConversationSummary | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = eventKindIcon(event.kind);

  return (
    <div
      className={cn(
        "rounded-lg border bg-bg-card p-3 shadow-sm transition-colors",
        selected ? "border-primary/60 ring-2 ring-primary/20" : "border-border",
      )}
      data-testid={`transcript-event-${event.event_id}`}
      onClick={onSelect}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-fg">
          <Icon className="h-4 w-4 shrink-0 text-fg-muted" />
          <span className="font-medium">{eventKindLabel(event.kind)}</span>
          <span className="text-fg-muted">•</span>
          <span className="truncate text-fg-muted">
            {conversation ? formatConversationTitle(conversation) : event.conversation_key}
          </span>
          {conversation?.channel ? <Badge variant="outline">{conversation.channel}</Badge> : null}
        </div>
        <time
          className="text-xs text-fg-muted"
          dateTime={event.occurred_at}
          title={event.occurred_at}
        >
          {formatRelativeTime(event.occurred_at)}
        </time>
      </div>
      {children}
    </div>
  );
}

function TranscriptTurnCard({ event }: { event: TranscriptTurnEvent }) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={turnStatusVariant(event.payload.turn.status)}>
          {event.payload.turn.status}
        </Badge>
        <Badge variant="outline">Attempt {event.payload.turn.attempt}</Badge>
      </div>
      <div className="grid gap-2 text-sm text-fg-muted sm:grid-cols-2">
        <div>{event.payload.turn_items.length} turn items</div>
        <div>{event.payload.turn.turn_id.slice(0, 8)}</div>
      </div>
      {event.payload.turn_items.length > 0 ? (
        <details className="rounded-md border border-border bg-bg-subtle/40 p-3">
          <summary className="cursor-pointer text-sm font-medium text-fg">Turn items</summary>
          <div className="mt-3 grid gap-2">
            {event.payload.turn_items.map((item) => {
              const text =
                item.kind === "message"
                  ? item.payload.message.parts
                      .map((part) =>
                        part.type === "text" && typeof part["text"] === "string"
                          ? part["text"].trim()
                          : "",
                      )
                      .filter((part) => part.length > 0)
                      .join(" ")
                  : "";
              return (
                <div
                  key={item.turn_item_id}
                  className="rounded-md border border-border bg-bg px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-fg">Item {item.item_index}</span>
                    <Badge variant="outline">{item.kind}</Badge>
                    <span className="text-xs text-fg-muted">{item.item_key}</span>
                  </div>
                  {text ? <div className="mt-2 text-xs text-fg-muted">{text}</div> : null}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function TranscriptApprovalCard({ event }: { event: TranscriptApprovalEvent }) {
  const approval = event.payload.approval;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{approval.kind}</Badge>
        <Badge variant={approvalStatusVariant(approval.status)}>{approval.status}</Badge>
      </div>
      <blockquote className="rounded-md border border-border bg-bg-subtle/40 px-3 py-2 text-sm text-fg">
        {approval.prompt}
      </blockquote>
    </div>
  );
}

function TranscriptSubagentCard({ event }: { event: TranscriptSubagentEvent }) {
  const subagent = event.payload.subagent;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={subagentPhaseVariant(event.payload.phase)}>{event.payload.phase}</Badge>
        <Badge variant="outline">{subagent.status}</Badge>
      </div>
      <div className="grid gap-2 text-sm text-fg-muted sm:grid-cols-2">
        <div>{subagent.execution_profile}</div>
        <div>Closed {subagent.closed_at ?? "\u2014"}</div>
      </div>
    </div>
  );
}

function TranscriptToolLifecycleCard({ event }: { event: TranscriptToolLifecycleEvent }) {
  const toolEvent = event.payload.tool_event;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={toolLifecycleStatusVariant(toolEvent.status)}>{toolEvent.status}</Badge>
        <Badge variant="outline">{toolEvent.tool_id}</Badge>
      </div>
      <div className="text-sm text-fg">{toolEvent.summary}</div>
      {toolEvent.error ? (
        <blockquote className="rounded-md border border-border bg-bg-subtle/40 px-3 py-2 text-sm text-fg-muted">
          {toolEvent.error}
        </blockquote>
      ) : null}
    </div>
  );
}

function TranscriptContextReportCard({ event }: { event: TranscriptContextReportEvent }) {
  const report = event.payload.report;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">Context report</Badge>
        <Badge variant="outline">{report.context_report_id.slice(0, 8)}</Badge>
      </div>
      <div className="text-sm text-fg-muted">{contextReportSummary(event)}</div>
      <div className="grid gap-2 text-sm text-fg-muted sm:grid-cols-2">
        <div>{report.selected_tools.length} selected tools</div>
        <div>{report.injected_files.length} injected files</div>
      </div>
    </div>
  );
}

export function TranscriptTimelinePanel(props: {
  approvalsById: Record<string, Approval>;
  errorDetailMessage: string | null;
  focusConversation: TranscriptConversationSummary | null;
  kindFilters: TimelineKindFilters;
  loadingDetail: boolean;
  renderMode: "markdown" | "text";
  selectedEventId: string | null;
  conversationsByKey: Map<string, TranscriptConversationSummary>;
  transcriptDetailPresent: boolean;
  visibleEvents: TranscriptTimelineEvent[];
  onToggleKind: (kind: TranscriptTimelineEvent["kind"]) => void;
  onSelectEvent: (eventId: string) => void;
}) {
  const {
    approvalsById,
    errorDetailMessage,
    focusConversation,
    kindFilters,
    loadingDetail,
    renderMode,
    selectedEventId,
    conversationsByKey,
    transcriptDetailPresent,
    visibleEvents,
    onToggleKind,
    onSelectEvent,
  } = props;

  return (
    <div className="min-h-0 border-b border-border lg:border-b-0 lg:border-r">
      <ScrollArea className="h-full">
        <div className="grid gap-4 p-4" data-testid="transcripts-page">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <div className="text-lg font-semibold text-fg">
                {focusConversation
                  ? formatConversationTitle(focusConversation)
                  : "Select a transcript"}
              </div>
              {focusConversation ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                  <span>{focusConversation.agent_key}</span>
                  <span>•</span>
                  <span>{focusConversation.channel}</span>
                  <span>•</span>
                  <span>{focusConversation.message_count} messages</span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {TIMELINE_KINDS.map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  size="sm"
                  variant={kindFilters[kind] ? "secondary" : "outline"}
                  onClick={() => {
                    onToggleKind(kind);
                  }}
                >
                  {eventKindLabel(kind)}
                </Button>
              ))}
            </div>
          </div>

          {errorDetailMessage ? (
            <Alert
              variant="error"
              title="Transcript detail unavailable"
              description={errorDetailMessage}
            />
          ) : null}

          {loadingDetail && !transcriptDetailPresent ? (
            <LoadingState variant="centered" label="Loading transcript timeline…" />
          ) : !transcriptDetailPresent ? (
            <EmptyState
              icon={Bot}
              title="No transcript selected"
              description="Choose a conversation from the left to inspect its complete retained transcript."
            />
          ) : visibleEvents.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No events match these filters"
              description="Re-enable one or more event types to inspect the retained timeline."
            />
          ) : (
            <div className="grid gap-3">
              {visibleEvents.map((event) => {
                const conversation = conversationsByKey.get(event.conversation_key) ?? null;
                const selected = event.event_id === selectedEventId;
                if (event.kind === "message") {
                  const message = toRenderableMessage(event);
                  if (!message) {
                    return null;
                  }
                  return (
                    <EventChrome
                      key={event.event_id}
                      event={event}
                      conversation={conversation}
                      selected={selected}
                      onSelect={() => {
                        onSelectEvent(event.event_id);
                      }}
                    >
                      <MessageCard
                        approvalsById={approvalsById}
                        interactiveApprovals={false}
                        message={message}
                        onResolveApproval={() => {}}
                        renderMode={renderMode}
                        resolvingApproval={null}
                      />
                    </EventChrome>
                  );
                }
                if (event.kind === "turn") {
                  return (
                    <EventChrome
                      key={event.event_id}
                      event={event}
                      conversation={conversation}
                      selected={selected}
                      onSelect={() => {
                        onSelectEvent(event.event_id);
                      }}
                    >
                      <TranscriptTurnCard event={event} />
                    </EventChrome>
                  );
                }
                if (event.kind === "approval") {
                  return (
                    <EventChrome
                      key={event.event_id}
                      event={event}
                      conversation={conversation}
                      selected={selected}
                      onSelect={() => {
                        onSelectEvent(event.event_id);
                      }}
                    >
                      <TranscriptApprovalCard event={event} />
                    </EventChrome>
                  );
                }
                if (event.kind === "tool_lifecycle") {
                  return (
                    <EventChrome
                      key={event.event_id}
                      event={event}
                      conversation={conversation}
                      selected={selected}
                      onSelect={() => {
                        onSelectEvent(event.event_id);
                      }}
                    >
                      <TranscriptToolLifecycleCard event={event} />
                    </EventChrome>
                  );
                }
                if (event.kind === "context_report") {
                  return (
                    <EventChrome
                      key={event.event_id}
                      event={event}
                      conversation={conversation}
                      selected={selected}
                      onSelect={() => {
                        onSelectEvent(event.event_id);
                      }}
                    >
                      <TranscriptContextReportCard event={event} />
                    </EventChrome>
                  );
                }
                return (
                  <EventChrome
                    key={event.event_id}
                    event={event}
                    conversation={conversation}
                    selected={selected}
                    onSelect={() => {
                      onSelectEvent(event.event_id);
                    }}
                  >
                    <TranscriptSubagentCard event={event} />
                  </EventChrome>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export function TranscriptInspectorPanel(props: {
  focusConversation: TranscriptConversationSummary | null;
  inspectorFields: InspectorField[];
  selectedEvent: TranscriptTimelineEvent | null;
}) {
  const { focusConversation, inspectorFields, selectedEvent } = props;
  const inspectorHint = focusConversation
    ? "Select a transcript event to inspect its raw payload."
    : "Select a transcript to inspect its events.";

  return (
    <div className="min-h-0">
      <ScrollArea className="h-full">
        <div className="grid gap-4 p-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="text-sm font-medium text-fg">Inspector</div>
              <div className="text-xs text-fg-muted">
                Raw details for the selected transcript event.
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {focusConversation ? (
                <div className="grid gap-1 text-sm text-fg-muted">
                  <div className="font-medium text-fg">
                    {formatConversationTitle(focusConversation)}
                  </div>
                </div>
              ) : null}
              {inspectorFields.length > 0 ? (
                <div className="grid gap-2">
                  <div className="grid gap-2 rounded-md border border-border bg-bg-subtle/30 p-3">
                    {inspectorFields.map((field) => (
                      <div
                        key={`${field.label}:${field.value}`}
                        className="grid gap-1 text-xs text-fg-muted"
                      >
                        <div className="font-medium uppercase tracking-wide">{field.label}</div>
                        <div className="break-all font-mono text-fg">{field.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {selectedEvent ? (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{eventKindLabel(selectedEvent.kind)}</Badge>
                    <time
                      className="text-xs text-fg-muted"
                      dateTime={selectedEvent.occurred_at}
                      title={selectedEvent.occurred_at}
                    >
                      {selectedEvent.occurred_at}
                    </time>
                  </div>
                  <div className="max-h-[480px] overflow-auto rounded-md border border-border bg-bg-subtle/30 p-3">
                    <StructuredValue value={selectedEvent} />
                  </div>
                </div>
              ) : focusConversation ? (
                <div className="max-h-[480px] overflow-auto rounded-md border border-border bg-bg-subtle/30 p-3">
                  <StructuredValue value={focusConversation} />
                </div>
              ) : (
                <div className="text-sm text-fg-muted">{inspectorHint}</div>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
