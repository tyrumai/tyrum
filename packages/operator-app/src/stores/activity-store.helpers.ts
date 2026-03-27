import type { AgentPersona } from "@tyrum/contracts";
import { parseTyrumKey } from "@tyrum/contracts";
import type {
  ActivityAttentionLevel,
  ActivityEvent,
  ActivityLeaseState,
  ActivityRoom,
  ActivityState,
  ActivityWorkstream,
} from "./activity-store.js";
import type { ChatState } from "./chat-store.js";

const MAX_RECENT_EVENTS = 10;
const MESSAGE_ATTENTION_SCORE = 650;
const IDLE_ATTENTION_SCORE = 100;
const DEFAULT_PERSONA: Omit<AgentPersona, "name"> = {
  tone: "direct",
  palette: "graphite",
  character: "operator",
};

export type ActivityIdentity = {
  key: string;
  conversationId: string | null;
  threadId: string | null;
};

export type MessageActivity = ActivityIdentity & {
  typing: boolean;
  bubbleText: string | null;
  recentEvents: ActivityEvent[];
};

export type DraftWorkstream = ActivityIdentity & {
  id: string;
  agentId: string | null;
  message: MessageActivity | null;
};

type Priority = {
  level: ActivityAttentionLevel;
  score: number;
};

export function createEmptyActivityState(): ActivityState {
  return {
    agentsById: {},
    agentIds: [],
    workstreamsById: {},
    workstreamIds: [],
    selectedAgentId: null,
    selectedWorkstreamId: null,
  };
}

function normalizeIdentifier(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function normalizeOccurredAt(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : new Date().toISOString();
}

export function resolveActivityIdentity(input: {
  conversationId?: string | null;
  threadId?: string | null;
}): ActivityIdentity | null {
  const conversationId = normalizeIdentifier(input.conversationId);
  const threadId = normalizeIdentifier(input.threadId);
  const key = conversationId ?? threadId;
  return key ? { key, conversationId, threadId } : null;
}

export function trimText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function toEvent(
  id: string,
  type: ActivityEvent["type"],
  occurredAt: string | null | undefined,
  summary: string,
): ActivityEvent {
  return { id, type, occurredAt: normalizeOccurredAt(occurredAt), summary };
}

export function appendRecentEvent(events: ActivityEvent[], next: ActivityEvent): ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>();
  for (const event of events) {
    byId.set(event.id, event);
  }
  byId.set(next.id, next);
  return [...byId.values()].toSorted(compareEvents).slice(0, MAX_RECENT_EVENTS);
}

export function compareEvents(left: ActivityEvent, right: ActivityEvent): number {
  const timeCmp = right.occurredAt.localeCompare(left.occurredAt);
  if (timeCmp !== 0) return timeCmp;
  return left.id.localeCompare(right.id);
}

function safeAgentIdFromKey(key: string): string | null {
  try {
    const parsed = parseTyrumKey(key);
    return parsed.kind === "agent" ? parsed.agent_key : null;
  } catch {
    return null;
  }
}

function titleCaseAgentId(agentId: string): string {
  return agentId
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function fallbackPersona(agentId: string): AgentPersona {
  return { name: titleCaseAgentId(agentId) || "Agent", ...DEFAULT_PERSONA };
}

export function createPersonaMap(chat: ChatState): Map<string, AgentPersona> {
  const personas = new Map<string, AgentPersona>();
  for (const agent of chat.agents.agents) {
    if (agent.persona) {
      personas.set(agent.agent_key, agent.persona);
    }
  }
  return personas;
}

export function createConversationAgentMap(chat: ChatState): Map<string, string> {
  const conversations = new Map<string, string>();
  for (const session of chat.conversations.conversations) {
    conversations.set(session.conversation_id, session.agent_key);
  }
  for (const session of chat.archivedConversations.conversations) {
    conversations.set(session.conversation_id, session.agent_key);
  }
  const activeConversation = chat.active.conversation;
  if (activeConversation) {
    conversations.set(activeConversation.conversation_id, activeConversation.agent_key);
  }
  return conversations;
}

export function determinePriority(message: MessageActivity | null): Priority {
  if (message && message.recentEvents.length > 0) {
    return { level: "medium", score: MESSAGE_ATTENTION_SCORE };
  }
  return { level: "idle", score: IDLE_ATTENTION_SCORE };
}

export function determineRoom(message: MessageActivity | null): ActivityRoom {
  return message && message.recentEvents.length > 0 ? "mail-room" : "lounge";
}

export function determineBubbleText(message: MessageActivity | null): string | null {
  return message?.bubbleText ?? null;
}

export function compareWorkstreamIds(
  leftId: string,
  rightId: string,
  workstreamsById: Record<string, ActivityWorkstream>,
): number {
  const left = workstreamsById[leftId];
  const right = workstreamsById[rightId];
  if (!left || !right) return leftId.localeCompare(rightId);

  const levelOrder: Record<ActivityAttentionLevel, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    idle: 1,
  };
  const levelCmp = levelOrder[right.attentionLevel] - levelOrder[left.attentionLevel];
  if (levelCmp !== 0) return levelCmp;

  const scoreCmp = right.attentionScore - left.attentionScore;
  if (scoreCmp !== 0) return scoreCmp;

  const leftTime = left.recentEvents[0]?.occurredAt ?? "";
  const rightTime = right.recentEvents[0]?.occurredAt ?? "";
  const timeCmp = rightTime.localeCompare(leftTime);
  if (timeCmp !== 0) return timeCmp;
  return left.id.localeCompare(right.id);
}

export function makeDraftWorkstream(
  identity: ActivityIdentity,
  conversationAgents: Map<string, string>,
): DraftWorkstream {
  const agentLookupKey = identity.conversationId ?? identity.key;
  return {
    id: identity.key,
    key: identity.key,
    conversationId: identity.conversationId,
    threadId: identity.threadId,
    agentId: conversationAgents.get(agentLookupKey) ?? safeAgentIdFromKey(agentLookupKey) ?? null,
    message: null,
  };
}

export function inactiveLeaseState(): ActivityLeaseState {
  return { owner: null, expiresAtMs: null, active: false };
}
