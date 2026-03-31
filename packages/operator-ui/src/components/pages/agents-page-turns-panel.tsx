import type { TranscriptConversationSummary, TranscriptTimelineEvent } from "@tyrum/contracts";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { EmptyState } from "../ui/empty-state.js";
import { LoadingState } from "../ui/loading-state.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { buildAgentTurnRows, type AgentTurnItemRow } from "./agents-page.lib.js";
import {
  approvalStatusVariant,
  formatConversationTitle,
  turnStatusVariant,
} from "./transcripts-page.lib.js";

function itemBadgeVariant(item: AgentTurnItemRow) {
  if (item.event.kind === "approval") {
    return approvalStatusVariant(item.event.payload.approval.status);
  }
  if (item.kind === "tool") {
    return "warning";
  }
  return "outline";
}

function itemKindLabel(item: AgentTurnItemRow): string {
  if (item.kind === "tool") {
    return "Tool";
  }
  if (item.event.kind === "approval") {
    return "Approval";
  }
  return "Message";
}

export function AgentsTurnTablePanel(props: {
  errorDetailMessage: string | null;
  focusConversation: TranscriptConversationSummary | null;
  loadingDetail: boolean;
  selectedEventId: string | null;
  transcriptDetailPresent: boolean;
  visibleEvents: TranscriptTimelineEvent[];
  onSelectEvent: (eventId: string) => void;
}) {
  const {
    errorDetailMessage,
    focusConversation,
    loadingDetail,
    selectedEventId,
    transcriptDetailPresent,
    visibleEvents,
    onSelectEvent,
  } = props;
  const turnRows = useMemo(() => buildAgentTurnRows(visibleEvents), [visibleEvents]);
  const [expandedTurnIds, setExpandedTurnIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (turnRows.length === 0) {
      setExpandedTurnIds({});
      return;
    }
    setExpandedTurnIds((current) => {
      const next: Record<string, boolean> = {};
      for (const row of turnRows) {
        if (current[row.turnEvent.payload.turn.turn_id]) {
          next[row.turnEvent.payload.turn.turn_id] = true;
        }
      }
      if (Object.keys(next).length === 0) {
        const latestTurnId = turnRows[0]?.turnEvent.payload.turn.turn_id;
        if (latestTurnId) {
          next[latestTurnId] = true;
        }
      }
      return next;
    });
  }, [turnRows]);

  return (
    <div className="min-h-0 border-b border-border lg:border-b-0 lg:border-r">
      <ScrollArea className="h-full">
        <div className="grid gap-4 p-4" data-testid="transcripts-page">
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

          {errorDetailMessage ? (
            <Alert
              variant="error"
              title="Transcript detail unavailable"
              description={errorDetailMessage}
            />
          ) : null}

          {loadingDetail && !transcriptDetailPresent ? (
            <LoadingState variant="centered" label="Loading transcript turns…" />
          ) : !transcriptDetailPresent ? (
            <EmptyState
              icon={Bot}
              title="No transcript selected"
              description="Choose a conversation from the left to inspect its turns."
            />
          ) : turnRows.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No recorded turns"
              description="This conversation has retained events but no turn records yet."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-bg">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-bg-subtle/70 text-fg-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Turn</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {turnRows.map((row) => {
                    const turn = row.turnEvent.payload.turn;
                    const expanded = expandedTurnIds[turn.turn_id] === true;
                    const latestItem = row.items[row.items.length - 1];
                    const turnSelected = selectedEventId === row.turnEvent.event_id;
                    return (
                      <Fragment key={row.turnEvent.event_id}>
                        <tr
                          className={cn(
                            "border-t border-border transition-colors",
                            turnSelected ? "bg-primary-dim/15" : "hover:bg-bg-subtle/40",
                          )}
                          data-testid={`agents-turn-row-${turn.turn_id}`}
                        >
                          <td className="px-3 py-2 align-top">
                            <button
                              type="button"
                              className="flex items-center gap-2 font-medium text-fg"
                              onClick={() => {
                                setExpandedTurnIds((current) => ({
                                  ...current,
                                  [turn.turn_id]: !(current[turn.turn_id] === true),
                                }));
                                onSelectEvent(row.turnEvent.event_id);
                              }}
                            >
                              {expanded ? (
                                <ChevronDown className="h-4 w-4 text-fg-muted" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-fg-muted" />
                              )}
                              <span>{turn.turn_id.slice(0, 8)}</span>
                            </button>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <Badge variant={turnStatusVariant(turn.status)}>{turn.status}</Badge>
                          </td>
                          <td className="px-3 py-2 align-top text-fg-muted">
                            <time dateTime={turn.created_at} title={turn.created_at}>
                              {formatRelativeTime(turn.created_at)}
                            </time>
                          </td>
                          <td className="px-3 py-2 align-top text-fg-muted">
                            {latestItem ? latestItem.summary : "No linked turn items yet"}
                          </td>
                        </tr>
                        {expanded
                          ? row.items.length > 0
                            ? row.items.map((item) => {
                                const selected = selectedEventId === item.eventId;
                                return (
                                  <tr
                                    key={item.id}
                                    className={cn(
                                      "border-t border-border/80 bg-bg-subtle/20 transition-colors",
                                      selected ? "bg-primary-dim/10" : "hover:bg-bg-subtle/40",
                                    )}
                                    data-testid={`agents-turn-item-${item.id}`}
                                    onClick={() => {
                                      onSelectEvent(item.eventId);
                                    }}
                                  >
                                    <td className="px-3 py-2 pl-10 text-fg-muted">
                                      {itemKindLabel(item)}
                                    </td>
                                    <td className="px-3 py-2">
                                      <Badge variant={itemBadgeVariant(item)}>{item.label}</Badge>
                                    </td>
                                    <td className="px-3 py-2 text-fg-muted">
                                      <time dateTime={item.occurredAt} title={item.occurredAt}>
                                        {formatRelativeTime(item.occurredAt)}
                                      </time>
                                    </td>
                                    <td className="px-3 py-2 text-fg">{item.summary}</td>
                                  </tr>
                                );
                              })
                            : [
                                <tr
                                  key={`${turn.turn_id}:empty`}
                                  className="border-t border-border/80"
                                >
                                  <td colSpan={4} className="px-3 py-3 pl-10 text-fg-muted">
                                    No linked message, tool, or approval events yet.
                                  </td>
                                </tr>,
                              ]
                          : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
