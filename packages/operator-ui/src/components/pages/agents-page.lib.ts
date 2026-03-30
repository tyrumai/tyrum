import type {
  TranscriptConversationSummary,
  TranscriptTimelineEvent,
  TranscriptTurnEvent,
} from "@tyrum/contracts";
export { buildTranscriptConversationsByKey as buildConversationsByKey } from "@tyrum/operator-app";
import {
  compareConversationsByCreatedAtAsc,
  compareConversationsByUpdatedAtDesc,
  formatConversationTitle,
} from "./transcripts-page.lib.js";

export type ManagedAgentOption = {
  agentKey: string;
  agentId: string;
  canDelete: boolean;
  displayName: string;
  isPrimary: boolean;
};

export type EditorMode = "closed" | "create" | "edit";

export type AgentsPageNavigationIntent = {
  agentKey: string;
  turnId?: string | null;
  conversationKey?: string | null;
};

export type AgentTurnItemKind = "message" | "tool" | "approval" | "subagent";

export type AgentTurnItemRow = {
  id: string;
  eventId: string;
  event: TranscriptTimelineEvent;
  kind: AgentTurnItemKind;
  occurredAt: string;
  label: string;
  summary: string;
};

export type AgentTurnRow = {
  turnEvent: TranscriptTurnEvent;
  items: AgentTurnItemRow[];
};

function trimAgentKey(value: string): string {
  return value.trim();
}

function shortId(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "unknown";
  }
  return trimmed.slice(0, 8);
}

function truncateText(value: string, max = 140): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function readMessageTurnId(
  event: Extract<TranscriptTimelineEvent, { kind: "message" }>,
): string | null {
  const metadata = event.payload.message.metadata;
  const turnId = typeof metadata?.["turn_id"] === "string" ? metadata["turn_id"].trim() : "";
  return turnId.length > 0 ? turnId : null;
}

function summarizeToolPart(part: Record<string, unknown>): string {
  const title = typeof part["title"] === "string" ? part["title"].trim() : "";
  const toolName =
    typeof part["toolName"] === "string"
      ? part["toolName"].trim()
      : typeof part["toolCallName"] === "string"
        ? part["toolCallName"].trim()
        : "";
  const state = typeof part["state"] === "string" ? part["state"].trim().replace(/-/g, " ") : "";
  const name = title || toolName || "Tool activity";
  return truncateText(state ? `${name} (${state})` : name);
}

function buildMessageItemRows(
  event: Extract<TranscriptTimelineEvent, { kind: "message" }>,
): AgentTurnItemRow[] {
  const rows: AgentTurnItemRow[] = [];
  for (const [partIndex, part] of event.payload.message.parts.entries()) {
    if (part.type === "text" && typeof part["text"] === "string") {
      const text = truncateText(part["text"]);
      if (!text) {
        continue;
      }
      rows.push({
        id: `${event.event_id}:part:${String(partIndex)}`,
        eventId: event.event_id,
        event,
        kind: "message",
        occurredAt: event.occurred_at,
        label: event.payload.message.role,
        summary: text,
      });
      continue;
    }
    const record = part as Record<string, unknown>;
    if (
      typeof record["toolCallId"] === "string" ||
      typeof record["toolName"] === "string" ||
      part.type.startsWith("tool-")
    ) {
      rows.push({
        id: `${event.event_id}:part:${String(partIndex)}`,
        eventId: event.event_id,
        event,
        kind: "tool",
        occurredAt: event.occurred_at,
        label: "tool",
        summary: summarizeToolPart(record),
      });
      continue;
    }
  }
  if (rows.length > 0) {
    return rows;
  }
  const role = event.payload.message.role;
  const fallbackSummary = truncateText(`${role} message`);
  return [
    {
      id: `${event.event_id}:fallback:0`,
      eventId: event.event_id,
      event,
      kind: "message",
      occurredAt: event.occurred_at,
      label: role,
      summary: fallbackSummary,
    },
  ];
}

function buildNonMessageItemRow(
  event: Exclude<TranscriptTimelineEvent, { kind: "turn" | "message" }>,
): AgentTurnItemRow {
  if (event.kind === "approval") {
    return {
      id: event.event_id,
      eventId: event.event_id,
      event,
      kind: "approval",
      occurredAt: event.occurred_at,
      label: event.payload.approval.status,
      summary: truncateText(event.payload.approval.prompt),
    };
  }
  return {
    id: event.event_id,
    eventId: event.event_id,
    event,
    kind: "subagent",
    occurredAt: event.occurred_at,
    label: event.payload.phase,
    summary: truncateText(
      event.payload.subagent.execution_profile || event.payload.subagent.conversation_key,
    ),
  };
}

function readTurnIdFromEvent(
  event: Exclude<TranscriptTimelineEvent, { kind: "turn" }>,
): string | null {
  if (event.kind === "message") {
    return readMessageTurnId(event);
  }
  if (event.kind === "approval") {
    const turnId =
      typeof event.payload.approval.scope?.turn_id === "string"
        ? event.payload.approval.scope.turn_id.trim()
        : "";
    return turnId.length > 0 ? turnId : null;
  }
  return null;
}

export function buildAgentTurnRows(events: readonly TranscriptTimelineEvent[]): AgentTurnRow[] {
  const turnRows = events
    .filter((event): event is TranscriptTurnEvent => event.kind === "turn")
    .toSorted((left, right) =>
      right.payload.turn.created_at.localeCompare(left.payload.turn.created_at),
    )
    .map((turnEvent) => ({ turnEvent, items: [] }));
  const byTurnId = new Map(
    turnRows.map((row) => [row.turnEvent.payload.turn.turn_id, row] as const),
  );

  for (const event of events) {
    if (event.kind === "turn") {
      continue;
    }
    const turnId = readTurnIdFromEvent(event);
    if (!turnId) {
      continue;
    }
    const row = byTurnId.get(turnId);
    if (!row) {
      continue;
    }
    if (event.kind === "message") {
      row.items.push(...buildMessageItemRows(event));
      continue;
    }
    row.items.push(buildNonMessageItemRow(event));
  }

  for (const row of turnRows) {
    row.items.sort((left, right) => {
      const timeCompare = left.occurredAt.localeCompare(right.occurredAt);
      if (timeCompare !== 0) {
        return timeCompare;
      }
      return left.id.localeCompare(right.id);
    });
  }

  return turnRows;
}

export function selectInitialAgentKey(input: {
  currentAgentKey: string;
  availableAgents: ManagedAgentOption[];
}): string {
  const current = trimAgentKey(input.currentAgentKey);
  if (input.availableAgents.some((agent) => agent.agentKey === current)) {
    return current;
  }
  return (
    input.availableAgents.find((agent) => agent.isPrimary)?.agentKey ??
    input.availableAgents[0]?.agentKey ??
    current
  );
}

export function findRootConversationKey(input: {
  conversationKey: string;
  conversationsByKey: ReadonlyMap<string, TranscriptConversationSummary>;
}): string | null {
  let current = input.conversationsByKey.get(input.conversationKey);
  if (!current) {
    return null;
  }
  const visited = new Set<string>();
  while (current.parent_conversation_key?.trim()) {
    if (visited.has(current.conversation_key)) {
      return current.conversation_key;
    }
    visited.add(current.conversation_key);
    const parent = input.conversationsByKey.get(current.parent_conversation_key);
    if (!parent) {
      break;
    }
    current = parent;
  }
  return current.conversation_key;
}

export function resolveConversationSelectionForIntent(input: {
  intent: AgentsPageNavigationIntent;
  conversations: readonly TranscriptConversationSummary[];
  conversationsByKey: ReadonlyMap<string, TranscriptConversationSummary>;
}): {
  matchedConversationKey: string | null;
  rootConversationKey: string | null;
} {
  const explicitConversationKey = input.intent.conversationKey?.trim() ?? "";
  const explicitConversation =
    explicitConversationKey.length > 0
      ? input.conversationsByKey.get(explicitConversationKey)
      : undefined;
  const matchedConversation =
    explicitConversation ??
    (input.intent.turnId
      ? input.conversations.find(
          (conversation) =>
            conversation.agent_key === input.intent.agentKey &&
            conversation.latest_turn_id === input.intent.turnId,
        )
      : undefined);
  if (!matchedConversation) {
    return {
      matchedConversationKey: null,
      rootConversationKey: null,
    };
  }
  return {
    matchedConversationKey: matchedConversation.conversation_key,
    rootConversationKey: findRootConversationKey({
      conversationKey: matchedConversation.conversation_key,
      conversationsByKey: input.conversationsByKey,
    }),
  };
}

export function buildRootConversationsByAgent(
  conversations: readonly TranscriptConversationSummary[],
): Map<string, TranscriptConversationSummary[]> {
  const rootsByAgent = new Map<string, TranscriptConversationSummary[]>();
  for (const conversation of conversations) {
    if (conversation.parent_conversation_key?.trim()) {
      continue;
    }
    const roots = rootsByAgent.get(conversation.agent_key) ?? [];
    roots.push(conversation);
    rootsByAgent.set(conversation.agent_key, roots);
  }
  for (const [agentKey, roots] of rootsByAgent) {
    rootsByAgent.set(agentKey, roots.toSorted(compareConversationsByUpdatedAtDesc));
  }
  return rootsByAgent;
}

export function reconcileActiveRootByAgentKey(input: {
  currentByAgentKey: Readonly<Record<string, string>>;
  agentKeys: readonly string[];
  rootsByAgent: ReadonlyMap<string, readonly TranscriptConversationSummary[]>;
}): Record<string, string> {
  const nextByAgentKey: Record<string, string> = {};
  for (const agentKey of input.agentKeys) {
    const roots = input.rootsByAgent.get(agentKey) ?? [];
    const currentRootKey = input.currentByAgentKey[agentKey];
    if (currentRootKey && roots.some((root) => root.conversation_key === currentRootKey)) {
      nextByAgentKey[agentKey] = currentRootKey;
      continue;
    }
    const latestRootKey = roots[0]?.conversation_key;
    if (latestRootKey) {
      nextByAgentKey[agentKey] = latestRootKey;
    }
  }
  return nextByAgentKey;
}

export function resolveActiveRootConversationKey(input: {
  agentKey: string;
  activeRootByAgentKey: Readonly<Record<string, string>>;
  rootsByAgent: ReadonlyMap<string, readonly TranscriptConversationSummary[]>;
}): string | null {
  const roots = input.rootsByAgent.get(input.agentKey) ?? [];
  const preferredRootKey = input.activeRootByAgentKey[input.agentKey];
  if (preferredRootKey && roots.some((root) => root.conversation_key === preferredRootKey)) {
    return preferredRootKey;
  }
  return roots[0]?.conversation_key ?? null;
}

export function buildChildConversationsByParentKey(
  conversationsByKey: ReadonlyMap<string, TranscriptConversationSummary>,
): Map<string, TranscriptConversationSummary[]> {
  const childrenByParentKey = new Map<string, TranscriptConversationSummary[]>();
  for (const conversation of conversationsByKey.values()) {
    const parentConversationKey = conversation.parent_conversation_key?.trim();
    if (!parentConversationKey) {
      continue;
    }
    const siblings = childrenByParentKey.get(parentConversationKey) ?? [];
    siblings.push(conversation);
    childrenByParentKey.set(parentConversationKey, siblings);
  }
  return childrenByParentKey;
}

export function buildChildConversationEntries(input: {
  rootConversationKey: string;
  childrenByParentKey: ReadonlyMap<string, readonly TranscriptConversationSummary[]>;
}): Array<{ conversation: TranscriptConversationSummary; depth: number }> {
  const result: Array<{ conversation: TranscriptConversationSummary; depth: number }> = [];
  const visited = new Set<string>([input.rootConversationKey]);
  const visit = (parentConversationKey: string, depth: number): void => {
    const children = (input.childrenByParentKey.get(parentConversationKey) ?? []).toSorted(
      compareConversationsByCreatedAtAsc,
    );
    for (const child of children) {
      if (visited.has(child.conversation_key)) {
        continue;
      }
      visited.add(child.conversation_key);
      result.push({ conversation: child, depth });
      visit(child.conversation_key, depth + 1);
    }
  };

  visit(input.rootConversationKey, 1);
  return result;
}

export function isConversationWithinRootLineage(input: {
  conversationKey: string;
  rootConversationKey: string;
  conversationsByKey: ReadonlyMap<string, TranscriptConversationSummary>;
}): boolean {
  let current = input.conversationsByKey.get(input.conversationKey);
  const visited = new Set<string>();
  while (current) {
    if (current.conversation_key === input.rootConversationKey) {
      return true;
    }
    if (visited.has(current.conversation_key)) {
      return false;
    }
    visited.add(current.conversation_key);
    const parentConversationKey = current.parent_conversation_key?.trim();
    if (!parentConversationKey) {
      return false;
    }
    current = input.conversationsByKey.get(parentConversationKey);
  }
  return false;
}

export function formatSubagentLabel(conversation: TranscriptConversationSummary): string {
  const title = conversation.title.trim();
  if (title) {
    return title;
  }
  const executionProfile = conversation.execution_profile?.trim();
  if (executionProfile) {
    return `${executionProfile} ${shortId(conversation.subagent_id)}`;
  }
  return `Subagent ${shortId(conversation.subagent_id)}`;
}

export function formatConversationLabel(conversation: TranscriptConversationSummary): string {
  const title = formatConversationTitle(conversation);
  return `${title} (${conversation.updated_at.slice(0, 10)})`;
}

export function formatConversationCount(count: number): string {
  if (count === 0) {
    return "No retained transcripts";
  }
  return count === 1 ? "1 conversation" : `${String(count)} conversations`;
}

export function subagentStatusVariant(status: TranscriptConversationSummary["subagent_status"]) {
  if (status === "failed") {
    return "danger";
  }
  if (status === "running" || status === "closing") {
    return "warning";
  }
  if (status === "paused") {
    return "default";
  }
  return "outline";
}
