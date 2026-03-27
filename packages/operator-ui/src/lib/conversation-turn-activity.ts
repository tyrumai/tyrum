import type { TurnsState } from "@tyrum/operator-app";
import type { TranscriptConversationSummary, Turn } from "@tyrum/contracts";

export function parseAgentKeyFromConversationKey(key: string): string | null {
  if (!key.startsWith("agent:")) return null;
  const rest = key.slice("agent:".length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  return rest.slice(0, sep);
}

export function isActiveTurnStatus(status: unknown): status is Turn["status"] {
  return status === "queued" || status === "running" || status === "paused";
}

export function resolveAgentKeyForTurn(
  turn: { turn_id: string; conversation_key: string },
  agentKeyByTurnId?: Readonly<Record<string, string>>,
): string | null {
  const mappedAgentKey = agentKeyByTurnId?.[turn.turn_id]?.trim();
  if (mappedAgentKey) return mappedAgentKey;
  return parseAgentKeyFromConversationKey(turn.conversation_key);
}

function hasActiveConversationTurn(conversation: TranscriptConversationSummary): boolean {
  return conversation.has_active_turn || isActiveTurnStatus(conversation.latest_turn_status);
}

export function collectActiveAgentKeys(input: {
  transcriptConversations: readonly TranscriptConversationSummary[];
  turnsState: Pick<TurnsState, "turnsById" | "agentKeyByTurnId">;
}): Set<string> {
  const activeAgentKeys = new Set<string>();

  for (const conversation of input.transcriptConversations) {
    if (!hasActiveConversationTurn(conversation)) {
      continue;
    }
    const agentKey =
      conversation.agent_key.trim() ||
      parseAgentKeyFromConversationKey(conversation.conversation_key);
    if (agentKey) {
      activeAgentKeys.add(agentKey);
    }
  }

  for (const turn of Object.values(input.turnsState.turnsById)) {
    if (!isActiveTurnStatus(turn.status)) {
      continue;
    }
    const agentKey = resolveAgentKeyForTurn(turn, input.turnsState.agentKeyByTurnId);
    if (agentKey) {
      activeAgentKeys.add(agentKey);
    }
  }

  return activeAgentKeys;
}

export function countActiveTurns(input: {
  transcriptConversations: readonly TranscriptConversationSummary[];
  turnsState: Pick<TurnsState, "turnsById">;
}): number {
  const activeTurnIds = new Set<string>();

  for (const conversation of input.transcriptConversations) {
    if (!hasActiveConversationTurn(conversation)) {
      continue;
    }
    const latestTurnId = conversation.latest_turn_id?.trim();
    activeTurnIds.add(
      latestTurnId && latestTurnId.length > 0
        ? latestTurnId
        : `conversation:${conversation.conversation_key}`,
    );
  }

  for (const turn of Object.values(input.turnsState.turnsById)) {
    if (isActiveTurnStatus(turn.status)) {
      activeTurnIds.add(turn.turn_id);
    }
  }

  return activeTurnIds.size;
}
