import type {
  TranscriptConversationSummary,
  TranscriptMessageEvent,
  TranscriptTimelineEvent,
  TranscriptTurnEvent,
  TyrumUIMessage,
  Turn,
  TurnItem,
} from "@tyrum/contracts";
import type { TranscriptState } from "./transcript-store.js";

function isActiveTurnStatus(status: Turn["status"]): boolean {
  return status === "queued" || status === "running" || status === "paused";
}

function compareTimelineEvents(
  left: TranscriptTimelineEvent,
  right: TranscriptTimelineEvent,
): number {
  const timeCompare = left.occurred_at.localeCompare(right.occurred_at);
  if (timeCompare !== 0) {
    return timeCompare;
  }
  return left.event_id.localeCompare(right.event_id);
}

function compareTurnItems(left: TurnItem, right: TurnItem): number {
  const indexCompare = left.item_index - right.item_index;
  if (indexCompare !== 0) {
    return indexCompare;
  }
  return left.turn_item_id.localeCompare(right.turn_item_id);
}

function appendOrReplaceTimelineEvent(
  events: readonly TranscriptTimelineEvent[],
  next: TranscriptTimelineEvent,
): TranscriptTimelineEvent[] {
  const byId = new Map(events.map((event) => [event.event_id, event] as const));
  byId.set(next.event_id, next);
  return [...byId.values()].toSorted(compareTimelineEvents);
}

function areUiMessagesEquivalent(left: TyrumUIMessage, right: TyrumUIMessage): boolean {
  return (
    left.id === right.id &&
    left.role === right.role &&
    JSON.stringify(left.parts) === JSON.stringify(right.parts) &&
    JSON.stringify(left.metadata ?? null) === JSON.stringify(right.metadata ?? null)
  );
}

function areTurnItemsEquivalent(left: TurnItem, right: TurnItem): boolean {
  return (
    left.turn_item_id === right.turn_item_id &&
    left.turn_id === right.turn_id &&
    left.item_index === right.item_index &&
    left.item_key === right.item_key &&
    left.kind === right.kind &&
    left.created_at === right.created_at &&
    areUiMessagesEquivalent(left.payload.message, right.payload.message)
  );
}

function upsertTurnItem(items: readonly TurnItem[], next: TurnItem): TurnItem[] {
  const existingIndex = items.findIndex((item) => item.turn_item_id === next.turn_item_id);
  if (existingIndex >= 0) {
    const existing = items[existingIndex];
    if (!existing) {
      return [...items, next].toSorted(compareTurnItems);
    }
    if (areTurnItemsEquivalent(existing, next)) {
      return [...items];
    }
    const updated = [...items];
    updated[existingIndex] = next;
    return updated.toSorted(compareTurnItems);
  }
  return [...items, next].toSorted(compareTurnItems);
}

function areTranscriptMessageEventsEquivalent(
  left: TranscriptMessageEvent,
  right: TranscriptMessageEvent,
): boolean {
  return (
    left.event_id === right.event_id &&
    left.occurred_at === right.occurred_at &&
    left.conversation_key === right.conversation_key &&
    left.parent_conversation_key === right.parent_conversation_key &&
    left.subagent_id === right.subagent_id &&
    areUiMessagesEquivalent(left.payload.message, right.payload.message)
  );
}

function buildTurnItemMessageEvent(
  turnEvent: TranscriptTurnEvent,
  turnItem: TurnItem,
): TranscriptMessageEvent | null {
  if (turnItem.kind !== "message") {
    return null;
  }
  return {
    event_id: `message:${turnEvent.conversation_key}:${turnItem.payload.message.id}`,
    kind: "message",
    occurred_at: turnItem.created_at,
    conversation_key: turnEvent.conversation_key,
    parent_conversation_key: turnEvent.parent_conversation_key,
    subagent_id: turnEvent.subagent_id,
    payload: {
      message: turnItem.payload.message,
    },
  };
}

function updateConversationSummariesForTurn(
  conversations: readonly TranscriptConversationSummary[],
  turn: Turn,
): { conversations: TranscriptConversationSummary[]; changed: boolean } {
  let changed = false;
  const updated = conversations.map((conversation) => {
    if (conversation.conversation_key !== turn.conversation_key) {
      return conversation;
    }
    const latestTurnId = conversation.latest_turn_id?.trim() ?? null;
    if (latestTurnId && latestTurnId !== turn.turn_id) {
      return conversation;
    }
    changed = true;
    return {
      ...conversation,
      latest_turn_id: turn.turn_id,
      latest_turn_status: turn.status,
      has_active_turn: isActiveTurnStatus(turn.status),
    };
  });
  return {
    conversations: changed ? updated : [...conversations],
    changed,
  };
}

export function applyTurnUpdatedToTranscriptState(
  prev: TranscriptState,
  turn: Turn,
): TranscriptState {
  const nextConversations = updateConversationSummariesForTurn(prev.conversations, turn);
  const detail = prev.detail;
  if (!detail) {
    return !nextConversations.changed
      ? prev
      : { ...prev, conversations: nextConversations.conversations };
  }

  let detailChanged = false;
  const nextDetailEvents = detail.events.map((event) => {
    if (event.kind !== "turn" || event.payload.turn.turn_id !== turn.turn_id) {
      return event;
    }
    detailChanged = true;
    return {
      ...event,
      payload: {
        ...event.payload,
        turn,
      },
    };
  });
  const nextDetailConversations = updateConversationSummariesForTurn(detail.conversations, turn);

  if (!nextConversations.changed && !detailChanged && !nextDetailConversations.changed) {
    return prev;
  }

  return {
    ...prev,
    conversations: nextConversations.conversations,
    detail:
      !detailChanged && !nextDetailConversations.changed
        ? detail
        : {
            ...detail,
            conversations: nextDetailConversations.conversations,
            events: detailChanged ? nextDetailEvents : detail.events,
          },
  };
}

export function applyTurnItemCreatedToTranscriptState(
  prev: TranscriptState,
  turnItem: TurnItem,
): TranscriptState {
  const detail = prev.detail;
  if (!detail) {
    return prev;
  }

  let matchedTurnEvent: TranscriptTurnEvent | null = null;
  let turnEventChanged = false;
  const nextEvents = detail.events.map((event) => {
    if (event.kind !== "turn" || event.payload.turn.turn_id !== turnItem.turn_id) {
      return event;
    }
    const nextTurnItems = upsertTurnItem(event.payload.turn_items, turnItem);
    const changed =
      nextTurnItems.length !== event.payload.turn_items.length ||
      nextTurnItems.some((item, index) => item !== event.payload.turn_items[index]);
    const nextTurnEvent = changed
      ? {
          ...event,
          payload: {
            ...event.payload,
            turn_items: nextTurnItems,
          },
        }
      : event;
    matchedTurnEvent = nextTurnEvent;
    turnEventChanged = changed;
    return nextTurnEvent;
  });

  if (!matchedTurnEvent) {
    return prev;
  }

  const nextMessageEvent = buildTurnItemMessageEvent(matchedTurnEvent, turnItem);
  if (!turnEventChanged) {
    if (!nextMessageEvent) {
      return prev;
    }
    const existingMessageEvent = detail.events.find(
      (event): event is TranscriptMessageEvent =>
        event.kind === "message" && event.event_id === nextMessageEvent.event_id,
    );
    if (
      existingMessageEvent &&
      areTranscriptMessageEventsEquivalent(existingMessageEvent, nextMessageEvent)
    ) {
      return prev;
    }
  }
  const mergedEvents = nextMessageEvent
    ? appendOrReplaceTimelineEvent(turnEventChanged ? nextEvents : detail.events, nextMessageEvent)
    : nextEvents;

  return {
    ...prev,
    detail: {
      ...detail,
      events: mergedEvents,
    },
  };
}
