import type { WsMessageRole } from "@tyrum/schemas";
import type { ExternalStore, Unsubscribe } from "../store.js";
import { createStore } from "../store.js";
import {
  appendRecentEvent,
  createEmptyActivityState,
  normalizeLane,
  toEvent,
  trimText,
  type MessageActivity,
} from "./activity-store.helpers.js";
import { buildActivityState } from "./activity-store.derive.js";
import type { ApprovalsState } from "./approvals-store.js";
import type { ChatState } from "./chat-store.js";
import type { MemoryState } from "./memory-store.js";
import type { RunsState } from "./runs-store.js";
import type { StatusState } from "./status-store.js";

export type ActivityRoom =
  | "lounge"
  | "strategy-desk"
  | "library"
  | "terminal-lab"
  | "archive"
  | "mail-room"
  | "approval-desk";

export type ActivityAttentionLevel = "critical" | "high" | "medium" | "low" | "idle";

export interface ActivityLeaseState {
  owner: string | null;
  expiresAtMs: number | null;
  active: boolean;
}

export interface ActivityEvent {
  id: string;
  type:
    | "run.updated"
    | "step.updated"
    | "attempt.updated"
    | "approval.updated"
    | "memory.item.updated"
    | "typing.started"
    | "typing.stopped"
    | "message.delta"
    | "message.final"
    | "delivery.receipt";
  occurredAt: string;
  summary: string;
}

export interface ActivityWorkstream {
  id: string;
  key: string;
  lane: string;
  agentId: string;
  persona: import("@tyrum/schemas").AgentPersona;
  latestRunId: string | null;
  runStatus: import("@tyrum/schemas").ExecutionRunStatus | null;
  queuedRunCount: number;
  lease: ActivityLeaseState;
  attentionLevel: ActivityAttentionLevel;
  currentRoom: ActivityRoom;
  bubbleText: string | null;
  recentEvents: ActivityEvent[];
}

export interface ActivityAgent {
  agentId: string;
  persona: import("@tyrum/schemas").AgentPersona;
  workstreamIds: string[];
  selectedWorkstreamId: string | null;
}

export interface ActivityState {
  agentsById: Record<string, ActivityAgent>;
  agentIds: string[];
  workstreamsById: Record<string, ActivityWorkstream>;
  workstreamIds: string[];
  selectedAgentId: string | null;
  selectedWorkstreamId: string | null;
}

export interface ActivityStore extends ExternalStore<ActivityState> {
  clearSelection(): void;
  selectWorkstream(workstreamId: string | null): void;
}

export interface ActivityStoreDeps {
  runsStore: ExternalStore<RunsState>;
  approvalsStore: ExternalStore<ApprovalsState>;
  statusStore: ExternalStore<StatusState>;
  memoryStore: ExternalStore<MemoryState>;
  chatStore: ExternalStore<ChatState>;
}

interface ActivityStoreBindings {
  store: ActivityStore;
  dispose(): void;
  handleTypingStarted(input: ActivityTypingInput): void;
  handleTypingStopped(input: ActivityTypingInput): void;
  handleMessageDelta(input: ActivityMessageDeltaInput): void;
  handleMessageFinal(input: ActivityMessageFinalInput): void;
  handleDeliveryReceipt(input: ActivityDeliveryReceiptInput): void;
}

type ActivityTypingInput = {
  sessionId: string;
  lane?: string | null;
  occurredAt?: string | null;
};

type ActivityMessageDeltaInput = ActivityTypingInput & {
  messageId: string;
  role: WsMessageRole;
  delta: string;
};

type ActivityMessageFinalInput = ActivityTypingInput & {
  messageId: string;
  role: WsMessageRole;
  content: string;
};

type ActivityDeliveryReceiptInput = ActivityTypingInput & {
  channel: string;
  threadId: string;
  status?: "sent" | "failed" | null;
  errorMessage?: string | null;
};

function updateMessageActivity(
  activityById: Map<string, MessageActivity>,
  key: string,
  lane: string,
  updater: (prev: MessageActivity | undefined) => MessageActivity,
): void {
  activityById.set(`${key}::${lane}`, updater(activityById.get(`${key}::${lane}`)));
}

export function createActivityStore(deps: ActivityStoreDeps): ActivityStoreBindings {
  const { store, setState } = createStore<ActivityState>(createEmptyActivityState());
  let selectedWorkstreamId: string | null = null;
  const messageActivityById = new Map<string, MessageActivity>();

  const recompute = (): void => {
    setState(() => buildActivityState(deps, selectedWorkstreamId, messageActivityById));
  };

  const unsubscribes: Unsubscribe[] = [
    deps.runsStore.subscribe(recompute),
    deps.approvalsStore.subscribe(recompute),
    deps.statusStore.subscribe(recompute),
    deps.memoryStore.subscribe(recompute),
    deps.chatStore.subscribe(recompute),
  ];

  const selectWorkstream = (workstreamId: string | null): void => {
    selectedWorkstreamId = workstreamId;
    recompute();
  };

  const applyMessageActivity = (
    key: string,
    lane: string,
    updater: (prev: MessageActivity | undefined) => MessageActivity,
  ): void => {
    updateMessageActivity(messageActivityById, key, lane, updater);
    recompute();
  };

  recompute();

  return {
    store: {
      ...store,
      clearSelection: () => selectWorkstream(null),
      selectWorkstream,
    },
    dispose() {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      unsubscribes.length = 0;
    },
    handleTypingStarted(input) {
      const key = input.sessionId.trim();
      if (!key) return;
      const lane = normalizeLane(input.lane);
      applyMessageActivity(key, lane, (prev) => ({
        key,
        lane,
        typing: true,
        bubbleText: prev?.bubbleText ?? null,
        recentEvents: appendRecentEvent(
          prev?.recentEvents ?? [],
          toEvent(`typing-started:${key}:${lane}`, "typing.started", input.occurredAt, "Typing"),
        ),
      }));
    },
    handleTypingStopped(input) {
      const key = input.sessionId.trim();
      if (!key) return;
      const lane = normalizeLane(input.lane);
      applyMessageActivity(key, lane, (prev) => ({
        key,
        lane,
        typing: false,
        bubbleText: prev?.bubbleText ?? null,
        recentEvents: appendRecentEvent(
          prev?.recentEvents ?? [],
          toEvent(
            `typing-stopped:${key}:${lane}`,
            "typing.stopped",
            input.occurredAt,
            "Typing stopped",
          ),
        ),
      }));
    },
    handleMessageDelta(input) {
      const key = input.sessionId.trim();
      if (!key) return;
      const lane = normalizeLane(input.lane);
      const bubbleText = trimText(input.delta);
      applyMessageActivity(key, lane, (prev) => ({
        key,
        lane,
        typing: prev?.typing ?? false,
        bubbleText: bubbleText ?? prev?.bubbleText ?? null,
        recentEvents: appendRecentEvent(
          prev?.recentEvents ?? [],
          toEvent(
            `message-delta:${input.messageId}`,
            "message.delta",
            input.occurredAt,
            bubbleText ?? "Message updated",
          ),
        ),
      }));
    },
    handleMessageFinal(input) {
      const key = input.sessionId.trim();
      if (!key) return;
      const lane = normalizeLane(input.lane);
      const bubbleText = trimText(input.content);
      applyMessageActivity(key, lane, (prev) => ({
        key,
        lane,
        typing: false,
        bubbleText: bubbleText ?? prev?.bubbleText ?? null,
        recentEvents: appendRecentEvent(
          prev?.recentEvents ?? [],
          toEvent(
            `message-final:${input.messageId}`,
            "message.final",
            input.occurredAt,
            bubbleText ?? "Message sent",
          ),
        ),
      }));
    },
    handleDeliveryReceipt(input) {
      const key = input.sessionId.trim();
      if (!key) return;
      const lane = normalizeLane(input.lane);
      const summary =
        input.status === "failed"
          ? (trimText(input.errorMessage) ?? "Delivery failed")
          : "Delivery sent";
      applyMessageActivity(key, lane, (prev) => ({
        key,
        lane,
        typing: prev?.typing ?? false,
        bubbleText: prev?.bubbleText ?? null,
        recentEvents: appendRecentEvent(
          prev?.recentEvents ?? [],
          toEvent(
            `delivery:${key}:${lane}:${input.channel}:${input.threadId}`,
            "delivery.receipt",
            input.occurredAt,
            summary,
          ),
        ),
      }));
    },
  };
}
