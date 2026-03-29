import type { ExecutionAttempt, ExecutionStep, Turn, TurnTriggerKind } from "@tyrum/contracts";
import type { OperatorWsClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";

export interface TurnsState {
  turnsById: Record<string, Turn>;
  stepsById: Record<string, ExecutionStep>;
  attemptsById: Record<string, ExecutionAttempt>;
  stepIdsByTurnId: Record<string, string[]>;
  attemptIdsByStepId: Record<string, string[]>;
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
  handleStepUpdated: (step: ExecutionStep) => void;
  handleAttemptUpdated: (attempt: ExecutionAttempt) => void;
} {
  const { store, setState } = createStore<TurnsState>({
    turnsById: {},
    stepsById: {},
    attemptsById: {},
    stepIdsByTurnId: {},
    attemptIdsByStepId: {},
    agentKeyByTurnId: {},
    conversationKeyByTurnId: {},
    triggerKindByTurnId: {},
  });

  let refreshRecentRunId = 0;
  let activeRefreshRecentRunId: number | null = null;
  let bufferedRuns = new Map<string, { turn: Turn; triggerKind?: TurnTriggerKind }>();
  let bufferedSteps = new Map<string, ExecutionStep>();
  let bufferedAttempts = new Map<string, ExecutionAttempt>();

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

  function handleStepUpdated(step: ExecutionStep): void {
    if (activeRefreshRecentRunId !== null) {
      bufferedSteps.set(step.step_id, step);
    }
    setState((prev) => ({
      ...prev,
      stepsById: { ...prev.stepsById, [step.step_id]: step },
      stepIdsByTurnId: {
        ...prev.stepIdsByTurnId,
        [step.turn_id]: addUniqueId(prev.stepIdsByTurnId[step.turn_id], step.step_id),
      },
    }));
  }

  function handleAttemptUpdated(attempt: ExecutionAttempt): void {
    if (activeRefreshRecentRunId !== null) {
      bufferedAttempts.set(attempt.attempt_id, attempt);
    }
    setState((prev) => ({
      ...prev,
      attemptsById: { ...prev.attemptsById, [attempt.attempt_id]: attempt },
      attemptIdsByStepId: {
        ...prev.attemptIdsByStepId,
        [attempt.step_id]: addUniqueId(
          prev.attemptIdsByStepId[attempt.step_id],
          attempt.attempt_id,
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
    bufferedSteps = new Map<string, ExecutionStep>();
    bufferedAttempts = new Map<string, ExecutionAttempt>();

    try {
      const result = await ws.turnList({
        ...(input?.limit ? { limit: input.limit } : undefined),
        ...(input?.statuses && input.statuses.length > 0
          ? { statuses: input.statuses }
          : undefined),
      });
      if (activeRefreshRecentRunId !== runId) return;

      const nextRuns = new Map<string, Turn>();
      const nextSteps = new Map<string, ExecutionStep>();
      const nextAttempts = new Map<string, ExecutionAttempt>();
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
      for (const step of result.steps) {
        nextSteps.set(step.step_id, step);
      }
      for (const attempt of result.attempts) {
        nextAttempts.set(attempt.attempt_id, attempt);
      }
      for (const [id, buffered] of bufferedRuns) {
        nextRuns.set(id, buffered.turn);
        if (buffered.triggerKind) {
          nextTriggerKinds.set(id, buffered.triggerKind);
        }
      }
      for (const [id, step] of bufferedSteps) {
        nextSteps.set(id, step);
      }
      for (const [id, attempt] of bufferedAttempts) {
        nextAttempts.set(id, attempt);
      }

      setState((prev) => {
        const turnsById = { ...prev.turnsById };
        const stepsById = { ...prev.stepsById };
        const attemptsById = { ...prev.attemptsById };
        const stepIdsByTurnId = { ...prev.stepIdsByTurnId };
        const attemptIdsByStepId = { ...prev.attemptIdsByStepId };
        const agentKeyByTurnId = { ...prev.agentKeyByTurnId };
        const conversationKeyByTurnId = { ...prev.conversationKeyByTurnId };
        const triggerKindByTurnId = { ...prev.triggerKindByTurnId };

        for (const run of nextRuns.values()) {
          turnsById[run.turn_id] = run;
        }
        for (const step of nextSteps.values()) {
          stepsById[step.step_id] = step;
          stepIdsByTurnId[step.turn_id] = addUniqueId(stepIdsByTurnId[step.turn_id], step.step_id);
        }
        for (const attempt of nextAttempts.values()) {
          attemptsById[attempt.attempt_id] = attempt;
          attemptIdsByStepId[attempt.step_id] = addUniqueId(
            attemptIdsByStepId[attempt.step_id],
            attempt.attempt_id,
          );
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
          stepsById,
          attemptsById,
          stepIdsByTurnId,
          attemptIdsByStepId,
          agentKeyByTurnId,
          conversationKeyByTurnId,
          triggerKindByTurnId,
        };
      });
    } finally {
      if (activeRefreshRecentRunId === runId) {
        activeRefreshRecentRunId = null;
        bufferedRuns = new Map<string, { turn: Turn; triggerKind?: TurnTriggerKind }>();
        bufferedSteps = new Map<string, ExecutionStep>();
        bufferedAttempts = new Map<string, ExecutionAttempt>();
      }
    }
  }

  return {
    store: {
      ...store,
      refreshRecent,
    },
    handleTurnUpdated,
    handleStepUpdated,
    handleAttemptUpdated,
  };
}
