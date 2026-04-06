import type { Turn, TurnItem, TurnTriggerKind } from "@tyrum/contracts";
import type { OperatorWsClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";

export interface TurnsState {
  turnsById: Record<string, Turn>;
  turnItemsById: Record<string, TurnItem>;
  turnItemIdsByTurnId: Record<string, string[]>;
  agentKeyByTurnId?: Record<string, string>;
  conversationKeyByTurnId?: Record<string, string>;
  triggerKindByTurnId?: Record<string, TurnTriggerKind>;
}

export interface TurnsStore extends ExternalStore<TurnsState> {
  refreshRecent(input?: { limit?: number; statuses?: Turn["status"][] }): Promise<void>;
}

function addUniqueId(list: string[] | undefined, id: string): string[] {
  if (!list) return [id];
  if (list.includes(id)) return list;
  return [...list, id];
}

export function createTurnsStore(ws: OperatorWsClient): {
  store: TurnsStore;
  handleTurnUpdated: (run: Turn, triggerKind?: TurnTriggerKind) => void;
  handleTurnItemCreated: (turnItem: TurnItem) => void;
} {
  const { store, setState } = createStore<TurnsState>({
    turnsById: {},
    turnItemsById: {},
    turnItemIdsByTurnId: {},
    agentKeyByTurnId: {},
    conversationKeyByTurnId: {},
    triggerKindByTurnId: {},
  });

  let refreshRecentRunId = 0;
  let activeRefreshRecentRunId: number | null = null;
  let bufferedRuns = new Map<string, { turn: Turn; triggerKind?: TurnTriggerKind }>();

  function handleTurnUpdated(run: Turn, triggerKind?: TurnTriggerKind): void {
    if (activeRefreshRecentRunId !== null) {
      bufferedRuns.set(run.turn_id, { turn: run, triggerKind });
    }
    setState((prev) => ({
      ...prev,
      turnsById: { ...prev.turnsById, [run.turn_id]: run },
      triggerKindByTurnId:
        triggerKind === undefined
          ? prev.triggerKindByTurnId
          : { ...prev.triggerKindByTurnId, [run.turn_id]: triggerKind },
    }));
  }

  function handleTurnItemCreated(turnItem: TurnItem): void {
    setState((prev) => ({
      ...prev,
      turnItemsById: { ...prev.turnItemsById, [turnItem.turn_item_id]: turnItem },
      turnItemIdsByTurnId: {
        ...prev.turnItemIdsByTurnId,
        [turnItem.turn_id]: addUniqueId(
          prev.turnItemIdsByTurnId[turnItem.turn_id],
          turnItem.turn_item_id,
        ),
      },
    }));
  }

  async function refreshRecent(input?: {
    limit?: number;
    statuses?: Turn["status"][];
  }): Promise<void> {
    const runId = ++refreshRecentRunId;
    activeRefreshRecentRunId = runId;
    bufferedRuns = new Map<string, { turn: Turn; triggerKind?: TurnTriggerKind }>();

    try {
      const result = await ws.turnList({
        ...(input?.limit ? { limit: input.limit } : undefined),
        ...(input?.statuses && input.statuses.length > 0
          ? { statuses: input.statuses }
          : undefined),
      });
      if (activeRefreshRecentRunId !== runId) return;

      const nextRuns = new Map<string, Turn>();
      const nextAgentKeys = new Map<string, string>();
      const nextConversationKeys = new Map<string, string>();
      const nextTriggerKinds = new Map<string, TurnTriggerKind>();

      for (const item of result.turns) {
        nextRuns.set(item.turn.turn_id, item.turn);
        if (item.agent_key) {
          nextAgentKeys.set(item.turn.turn_id, item.agent_key);
        }
        if (item.conversation_key) {
          nextConversationKeys.set(item.turn.turn_id, item.conversation_key);
        }
        if (item.trigger_kind) {
          nextTriggerKinds.set(item.turn.turn_id, item.trigger_kind);
        }
      }
      for (const [id, buffered] of bufferedRuns) {
        nextRuns.set(id, buffered.turn);
        if (buffered.triggerKind) {
          nextTriggerKinds.set(id, buffered.triggerKind);
        }
      }

      setState((prev) => {
        const turnsById = { ...prev.turnsById };
        const agentKeyByTurnId = { ...prev.agentKeyByTurnId };
        const conversationKeyByTurnId = { ...prev.conversationKeyByTurnId };
        const triggerKindByTurnId = { ...prev.triggerKindByTurnId };

        for (const run of nextRuns.values()) {
          turnsById[run.turn_id] = run;
        }
        for (const [id, agentKey] of nextAgentKeys) {
          agentKeyByTurnId[id] = agentKey;
        }
        for (const [id, conversationKey] of nextConversationKeys) {
          conversationKeyByTurnId[id] = conversationKey;
        }
        for (const [id, triggerKind] of nextTriggerKinds) {
          triggerKindByTurnId[id] = triggerKind;
        }

        return {
          ...prev,
          turnsById,
          agentKeyByTurnId,
          conversationKeyByTurnId,
          triggerKindByTurnId,
        };
      });
    } finally {
      if (activeRefreshRecentRunId === runId) {
        activeRefreshRecentRunId = null;
        bufferedRuns = new Map<string, { turn: Turn; triggerKind?: TurnTriggerKind }>();
      }
    }
  }

  return {
    store: {
      ...store,
      refreshRecent,
    },
    handleTurnUpdated,
    handleTurnItemCreated,
  };
}
