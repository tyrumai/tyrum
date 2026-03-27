import type { TranscriptConversationSummary, Turn } from "@tyrum/contracts";
import type { TurnsState } from "./stores/runs-store.js";

export type OperatorRecentActivitySource = {
  label: string;
  detail: string | null;
  title: string;
};

export type OperatorRecentActivityRow = {
  id: string;
  turnId: string | null;
  turnAttempt: number | null;
  agentKey: string;
  agentName: string;
  conversationKey: string;
  occurredAt: string;
  turnStatus: Turn["status"] | null;
  source: OperatorRecentActivitySource;
};

export type RecentActivityState = {
  rows: OperatorRecentActivityRow[];
};

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function titleCaseIdentifier(value: string): string {
  return value
    .split(/[-_:/]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function shortId(value: string | undefined): string | null {
  const trimmed = normalizeOptionalString(value);
  return trimmed ? trimmed.slice(0, 8) : null;
}

function formatConnectorLabel(channel: string): string {
  switch (channel.trim()) {
    case "ui":
      return "UI";
    case "googlechat":
      return "Google Chat";
    default:
      return titleCaseIdentifier(channel);
  }
}

function formatAccountKey(accountKey: string | undefined): string | null {
  const normalized = normalizeOptionalString(accountKey);
  return normalized && normalized !== "default" ? normalized : null;
}

function formatSourceLabel(
  conversation: TranscriptConversationSummary | undefined,
  conversationKey: string,
): string {
  if (!conversation) {
    if (conversationKey.startsWith("cron:")) return "Cron";
    if (conversationKey.startsWith("hook:")) return "Hook";
    if (conversationKey.startsWith("node:")) return "Node";
    return "Conversation";
  }
  if (normalizeOptionalString(conversation.subagent_id)) {
    return "Subagent";
  }
  const connector = formatConnectorLabel(conversation.channel);
  const containerKind = normalizeOptionalString(conversation.container_kind);
  if (!containerKind) {
    return connector;
  }
  if (connector === "UI") {
    return "UI thread";
  }
  if (containerKind === "dm") {
    return `${connector} DM`;
  }
  return `${connector} ${titleCaseIdentifier(containerKind)}`;
}

function formatSourceDetail(
  conversation: TranscriptConversationSummary | undefined,
  conversationKey: string,
): string | null {
  if (!conversation) {
    return conversationKey.startsWith("agent:") ? "Agent conversation" : null;
  }
  if (normalizeOptionalString(conversation.subagent_id)) {
    return [
      normalizeOptionalString(conversation.execution_profile),
      shortId(conversation.subagent_id),
    ]
      .filter((part): part is string => part !== null)
      .join(" • ");
  }
  return [
    normalizeOptionalString(conversation.thread_id),
    formatAccountKey(conversation.account_key),
  ]
    .filter((part): part is string => part !== null)
    .join(" • ");
}

function buildSource(
  conversation: TranscriptConversationSummary | undefined,
  conversationKey: string,
): OperatorRecentActivitySource {
  const label = formatSourceLabel(conversation, conversationKey);
  const detail = formatSourceDetail(conversation, conversationKey);
  return {
    label,
    detail,
    title: detail ? `${label} • ${detail}` : label,
  };
}

function getTurnOccurredAt(turn: Turn): string {
  return turn.finished_at ?? turn.started_at ?? turn.created_at;
}

function compareTurns(left: Turn, right: Turn): number {
  const timeCompare = getTurnOccurredAt(right).localeCompare(getTurnOccurredAt(left));
  if (timeCompare !== 0) {
    return timeCompare;
  }
  return right.turn_id.localeCompare(left.turn_id);
}

function compareConversations(
  left: TranscriptConversationSummary,
  right: TranscriptConversationSummary,
): number {
  const timeCompare = right.updated_at.localeCompare(left.updated_at);
  if (timeCompare !== 0) {
    return timeCompare;
  }
  return left.conversation_key.localeCompare(right.conversation_key);
}

function buildConversationActivityRows(input: {
  transcriptConversations: readonly TranscriptConversationSummary[];
  turnsState: Pick<TurnsState, "turnsById">;
  agentNameByKey: ReadonlyMap<string, string>;
  limit?: number;
}): OperatorRecentActivityRow[] {
  const rows: OperatorRecentActivityRow[] = [];

  for (const conversation of input.transcriptConversations.toSorted(compareConversations)) {
    if (input.limit !== undefined && rows.length >= input.limit) {
      break;
    }

    const turnId = normalizeOptionalString(conversation.latest_turn_id);
    const turn = turnId ? input.turnsState.turnsById[turnId] : undefined;
    const turnStatus = turn?.status ?? conversation.latest_turn_status ?? null;
    if (!turnId && turnStatus === null && !conversation.has_active_turn) {
      continue;
    }

    const agentKey = normalizeOptionalString(conversation.agent_key) ?? "default";
    rows.push({
      id: turnId ?? `conversation:${conversation.conversation_key}`,
      turnId,
      turnAttempt: turn?.attempt ?? null,
      agentKey,
      agentName: input.agentNameByKey.get(agentKey) ?? agentKey,
      conversationKey: conversation.conversation_key,
      occurredAt: turn ? getTurnOccurredAt(turn) : conversation.updated_at,
      turnStatus,
      source: buildSource(conversation, conversation.conversation_key),
    });
  }

  return rows;
}

function buildTurnFallbackRows(input: {
  turnsState: Pick<TurnsState, "turnsById" | "agentKeyByTurnId" | "conversationKeyByTurnId">;
  transcriptConversationsByKey: ReadonlyMap<string, TranscriptConversationSummary>;
  agentNameByKey: ReadonlyMap<string, string>;
  limit?: number;
}): OperatorRecentActivityRow[] {
  const turns = Object.values(input.turnsState.turnsById).toSorted(compareTurns);
  const rows: OperatorRecentActivityRow[] = [];

  for (const turn of turns) {
    if (input.limit !== undefined && rows.length >= input.limit) {
      break;
    }

    const conversationKey =
      normalizeOptionalString(input.turnsState.conversationKeyByTurnId?.[turn.turn_id] ?? null) ??
      normalizeOptionalString(turn.conversation_key) ??
      "conversation";
    const conversation = input.transcriptConversationsByKey.get(conversationKey);
    const agentKey =
      normalizeOptionalString(input.turnsState.agentKeyByTurnId?.[turn.turn_id] ?? null) ??
      normalizeOptionalString(conversation?.agent_key) ??
      "default";
    rows.push({
      id: turn.turn_id,
      turnId: turn.turn_id,
      turnAttempt: turn.attempt,
      agentKey,
      agentName: input.agentNameByKey.get(agentKey) ?? agentKey,
      conversationKey,
      occurredAt: getTurnOccurredAt(turn),
      turnStatus: turn.status,
      source: buildSource(conversation, conversationKey),
    });
  }

  return rows;
}

function compareActivityRows(
  left: OperatorRecentActivityRow,
  right: OperatorRecentActivityRow,
): number {
  const timeCompare = right.occurredAt.localeCompare(left.occurredAt);
  if (timeCompare !== 0) {
    return timeCompare;
  }
  return left.id.localeCompare(right.id);
}

function selectNewestRowsByConversation(input: {
  rows: readonly OperatorRecentActivityRow[];
  limit: number;
}): OperatorRecentActivityRow[] {
  const newestByConversationKey = new Map<string, OperatorRecentActivityRow>();

  for (const row of input.rows.toSorted(compareActivityRows)) {
    if (newestByConversationKey.has(row.conversationKey)) {
      continue;
    }
    newestByConversationKey.set(row.conversationKey, row);
    if (newestByConversationKey.size >= input.limit) {
      break;
    }
  }

  return [...newestByConversationKey.values()];
}

export function buildAgentNameByKey(
  agents: Array<{
    agent_key?: string;
    persona?: {
      name?: string | null;
    } | null;
  }>,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const agent of agents) {
    const agentKey = normalizeOptionalString(agent.agent_key);
    if (!agentKey) {
      continue;
    }
    const displayName = normalizeOptionalString(agent.persona?.name ?? null);
    names.set(agentKey, displayName ?? agentKey);
  }
  return names;
}

export function buildTranscriptConversationsByKey(
  transcriptConversations: readonly TranscriptConversationSummary[],
): Map<string, TranscriptConversationSummary> {
  const byKey = new Map<string, TranscriptConversationSummary>();
  for (const conversation of transcriptConversations) {
    byKey.set(conversation.conversation_key, conversation);
  }
  return byKey;
}

export function buildRecentActivityState(input: {
  turnsState: Pick<TurnsState, "turnsById" | "agentKeyByTurnId" | "conversationKeyByTurnId">;
  transcriptConversations: readonly TranscriptConversationSummary[];
  agentNameByKey: ReadonlyMap<string, string>;
  limit?: number;
}): RecentActivityState {
  const limit = input.limit ?? 8;
  const transcriptConversationsByKey = buildTranscriptConversationsByKey(
    input.transcriptConversations,
  );
  const conversationRows = buildConversationActivityRows({
    transcriptConversations: input.transcriptConversations,
    turnsState: input.turnsState,
    agentNameByKey: input.agentNameByKey,
  });
  const turnRows = buildTurnFallbackRows({
    turnsState: input.turnsState,
    transcriptConversationsByKey,
    agentNameByKey: input.agentNameByKey,
  });
  const mergedRows = selectNewestRowsByConversation({
    rows: [...conversationRows, ...turnRows],
    limit,
  });

  return { rows: mergedRows };
}
