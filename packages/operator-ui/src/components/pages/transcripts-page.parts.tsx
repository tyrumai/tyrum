import type { OperatorCore } from "@tyrum/operator-app";
import type {
  Approval,
  ArtifactRef,
  TranscriptApprovalEvent,
  TranscriptRunEvent,
  TranscriptSessionSummary,
  TranscriptSubagentEvent,
  TranscriptTimelineEvent,
} from "@tyrum/contracts";
import { Bot, FileText, GitBranch, ShieldCheck, Workflow } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { ArtifactInlinePreview } from "../artifacts/artifact-inline-preview.js";
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
  formatSessionTitle,
  runStatusVariant,
  subagentPhaseVariant,
  toRenderableMessage,
  type InspectorField,
  type TimelineKindFilters,
} from "./transcripts-page.lib.js";

function eventKindIcon(kind: TranscriptTimelineEvent["kind"]) {
  switch (kind) {
    case "message":
      return FileText;
    case "run":
      return Workflow;
    case "approval":
      return ShieldCheck;
    case "subagent":
      return GitBranch;
  }
  return FileText;
}

function EventChrome({
  children,
  event,
  session,
  selected,
  onSelect,
}: {
  children: ReactNode;
  event: TranscriptTimelineEvent;
  session: TranscriptSessionSummary | null;
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
            {session ? formatSessionTitle(session) : event.session_key}
          </span>
          {session?.channel ? <Badge variant="outline">{session.channel}</Badge> : null}
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

function TranscriptRunCard({ event }: { event: TranscriptRunEvent }) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={runStatusVariant(event.payload.run.status)}>
          {event.payload.run.status}
        </Badge>
        <Badge variant="outline">{event.payload.run.lane}</Badge>
      </div>
      <div className="grid gap-2 text-sm text-fg-muted sm:grid-cols-3">
        <div>{event.payload.steps.length} steps</div>
        <div>{event.payload.attempts.length} attempts</div>
        <div>Attempt {event.payload.run.attempt}</div>
      </div>
      {event.payload.steps.length > 0 ? (
        <details className="rounded-md border border-border bg-bg-subtle/40 p-3">
          <summary className="cursor-pointer text-sm font-medium text-fg">Step breakdown</summary>
          <div className="mt-3 grid gap-2">
            {event.payload.steps.map((step) => {
              const attempts = event.payload.attempts.filter(
                (attempt) => attempt.step_id === step.step_id,
              );
              return (
                <div key={step.step_id} className="rounded-md border border-border bg-bg px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-fg">Step {step.step_index}</span>
                    <Badge variant="outline">{step.status}</Badge>
                    <span className="text-xs text-fg-muted">
                      {String(step.action?.["type"] ?? "action")}
                    </span>
                  </div>
                  {attempts.length > 0 ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                      {attempts.map((attempt) => (
                        <span key={attempt.attempt_id}>
                          Attempt {attempt.attempt} {attempt.status}
                        </span>
                      ))}
                    </div>
                  ) : null}
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
        <Badge variant="outline">{subagent.lane}</Badge>
      </div>
      <div className="grid gap-2 text-sm text-fg-muted sm:grid-cols-2">
        <div>{subagent.execution_profile}</div>
        <div>Closed {subagent.closed_at ?? "\u2014"}</div>
      </div>
    </div>
  );
}

export function TranscriptTimelinePanel(props: {
  approvalsById: Record<string, Approval>;
  errorDetailMessage: string | null;
  focusSession: TranscriptSessionSummary | null;
  kindFilters: TimelineKindFilters;
  loadingDetail: boolean;
  renderMode: "markdown" | "text";
  selectedEventId: string | null;
  sessionsByKey: Map<string, TranscriptSessionSummary>;
  transcriptDetailPresent: boolean;
  visibleEvents: TranscriptTimelineEvent[];
  onToggleKind: (kind: TranscriptTimelineEvent["kind"]) => void;
  onSelectEvent: (eventId: string) => void;
}) {
  const {
    approvalsById,
    errorDetailMessage,
    focusSession,
    kindFilters,
    loadingDetail,
    renderMode,
    selectedEventId,
    sessionsByKey,
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
                {focusSession ? formatSessionTitle(focusSession) : "Select a transcript"}
              </div>
              {focusSession ? (
                <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                  <span>{focusSession.agent_key}</span>
                  <span>•</span>
                  <span>{focusSession.channel}</span>
                  <span>•</span>
                  <span>{focusSession.message_count} messages</span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {(["message", "run", "approval", "subagent"] as const).map((kind) => (
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
              description="Choose a session from the left to inspect its complete retained timeline."
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
                const session = sessionsByKey.get(event.session_key) ?? null;
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
                      session={session}
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
                if (event.kind === "run") {
                  return (
                    <EventChrome
                      key={event.event_id}
                      event={event}
                      session={session}
                      selected={selected}
                      onSelect={() => {
                        onSelectEvent(event.event_id);
                      }}
                    >
                      <TranscriptRunCard event={event} />
                    </EventChrome>
                  );
                }
                if (event.kind === "approval") {
                  return (
                    <EventChrome
                      key={event.event_id}
                      event={event}
                      session={session}
                      selected={selected}
                      onSelect={() => {
                        onSelectEvent(event.event_id);
                      }}
                    >
                      <TranscriptApprovalCard event={event} />
                    </EventChrome>
                  );
                }
                return (
                  <EventChrome
                    key={event.event_id}
                    event={event}
                    session={session}
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
  core: OperatorCore;
  focusSession: TranscriptSessionSummary | null;
  inspectorFields: InspectorField[];
  selectedEvent: TranscriptTimelineEvent | null;
  selectedEventArtifacts: ArtifactRef[];
}) {
  const { core, focusSession, inspectorFields, selectedEvent, selectedEventArtifacts } = props;
  const inspectorHint = focusSession
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
                Raw details for the selected session event.
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {focusSession ? (
                <div className="grid gap-1 text-sm text-fg-muted">
                  <div className="font-medium text-fg">{formatSessionTitle(focusSession)}</div>
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
              {selectedEventArtifacts.length > 0 ? (
                <div className="grid gap-2">
                  <div className="text-sm font-medium text-fg">Artifacts</div>
                  {selectedEventArtifacts.map((artifact) => (
                    <div
                      key={artifact.artifact_id}
                      className="grid gap-2 rounded-md border border-border bg-bg-subtle/30 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{artifact.kind}</Badge>
                      </div>
                      <ArtifactInlinePreview core={core} artifact={artifact} />
                    </div>
                  ))}
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
              ) : focusSession ? (
                <div className="max-h-[480px] overflow-auto rounded-md border border-border bg-bg-subtle/30 p-3">
                  <StructuredValue value={focusSession} />
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
