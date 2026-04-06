import { AgentTurnRequest, type AgentTurnRequest as AgentTurnRequestT } from "@tyrum/contracts";
import type { AgentRegistry } from "../registry.js";
import type { Logger } from "../../observability/logger.js";
import { deriveAgentKeyFromKey } from "../../execution/gateway-step-executor-types.js";
import { ToolExecutionApprovalRequiredError } from "./turn-helpers.js";
import type { TurnEngineBridgeDeps } from "./turn-engine-bridge.js";
import { normalizeInternalTurnRequestUnknown } from "./turn-request-normalization.js";
import { maybeResolvePausedTurn } from "./turn-engine-bridge-turn-state.js";
import type { TurnController } from "./turn-controller.js";
import {
  executeClaimedConversationTurn,
  TURN_RUNNER_LEASE_TTL_MS,
  type PreparedConversationTurnExecution,
} from "./turn-via-turn-runner.js";
import { TurnRunner, type TurnRunnerTurn } from "./turn-runner.js";
import { NATIVE_TURN_RUNNER_INPUT_MARKER_PATTERN } from "./turn-runner-native-marker.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCreatedAtMs(createdAt: string): number {
  const createdAtMs = Date.parse(createdAt);
  return Number.isFinite(createdAtMs) ? createdAtMs : Date.now();
}

type PersistedConversationTurnInput = {
  planId: string;
  request: AgentTurnRequestT;
};

async function loadPersistedConversationTurnInput(
  db: {
    get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
  },
  turnId: string,
): Promise<PersistedConversationTurnInput | undefined> {
  const row = await db.get<{ input_json: string | null }>(
    `SELECT j.input_json
       FROM turns r
       JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
       WHERE r.turn_id = ?
       LIMIT 1`,
    [turnId],
  );
  if (!row?.input_json) return undefined;

  try {
    const parsed = JSON.parse(row.input_json) as Record<string, unknown>;
    const request = AgentTurnRequest.safeParse(
      normalizeInternalTurnRequestUnknown(parsed["request"]),
    );
    if (!request.success) return undefined;

    const planId =
      typeof parsed["plan_id"] === "string" && parsed["plan_id"].trim().length > 0
        ? parsed["plan_id"].trim()
        : turnId;
    return { planId, request: request.data };
  } catch {
    // Intentional: invalid or partially written persisted input should be skipped, not crash the loop.
    return undefined;
  }
}

async function listConversationTurnTenantIds(db: {
  all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}): Promise<string[]> {
  const rows = await db.all<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id
       FROM turn_jobs
       WHERE status IN ('queued', 'running')
         AND input_json LIKE ?
       ORDER BY tenant_id ASC`,
    [NATIVE_TURN_RUNNER_INPUT_MARKER_PATTERN],
  );
  return rows.map((row) => row.tenant_id);
}

async function loadTurnStatus(
  db: {
    get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
  },
  turnId: string,
): Promise<string | undefined> {
  return (
    await db.get<{ status: string }>(
      `SELECT status
         FROM turns
         WHERE turn_id = ?
         LIMIT 1`,
      [turnId],
    )
  )?.status;
}

async function failClaimedTurn(
  runner: TurnRunner,
  turn: TurnRunnerTurn,
  owner: string,
  error: string,
): Promise<void> {
  await runner.fail({
    tenantId: turn.tenant_id,
    turnId: turn.turn_id,
    owner,
    nowIso: new Date().toISOString(),
    error,
  });
}

async function resolvePausedConversationTurn(input: {
  runner: TurnRunner;
  tenantId: string;
  db: {
    all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  };
  approvalDal: { expireStale(input: { tenantId: string; nowIso?: string }): Promise<number> };
  turnController: TurnController;
}): Promise<boolean> {
  const paused = await input.runner.listPausedConversationTurns(input.tenantId, 5);
  for (const turn of paused) {
    const resolved = await maybeResolvePausedTurn(
      {
        approvalDal: input.approvalDal as never,
        db: input.db as never,
        turnController: input.turnController,
      },
      turn.turn_id,
    );
    if (resolved) {
      return true;
    }
  }
  return false;
}

export interface ConversationTurnLoop {
  stop: () => void;
  done: Promise<void>;
}

export interface ConversationTurnLoopOptions {
  agents: AgentRegistry;
  db: {
    get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
    all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  };
  approvalDal: {
    expireStale(input: { tenantId: string; nowIso?: string }): Promise<number>;
  };
  turnController: TurnController;
  owner: string;
  logger?: Pick<Logger, "info" | "error" | "warn">;
  idleSleepMs?: number;
  errorSleepMs?: number;
  maxTicksPerCycle?: number;
}

export function startConversationTurnLoop(opts: ConversationTurnLoopOptions): ConversationTurnLoop {
  const idleSleepMs = Math.max(10, Math.floor(opts.idleSleepMs ?? 250));
  const errorSleepMs = Math.max(10, Math.floor(opts.errorSleepMs ?? 1_000));
  const maxTicksPerCycle = Math.max(1, Math.floor(opts.maxTicksPerCycle ?? 25));
  const runner = new TurnRunner(opts.db as never);

  async function processClaimedTurn(turn: TurnRunnerTurn): Promise<void> {
    const loaded = await loadPersistedConversationTurnInput(opts.db, turn.turn_id);
    if (!loaded) {
      await failClaimedTurn(
        runner,
        turn,
        opts.owner,
        "conversation turn request payload missing or invalid",
      );
      return;
    }

    const agentKey =
      loaded.request.agent_key?.trim() || deriveAgentKeyFromKey(turn.conversation_key);
    const runtime = await opts.agents.getRuntime({
      tenantId: turn.tenant_id,
      agentKey,
    });
    const startMs = parseCreatedAtMs(turn.created_at);
    const prepared: PreparedConversationTurnExecution = {
      planId: loaded.planId,
      deadlineMs: startMs + runtime.turnEngineWaitMs,
      key: turn.conversation_key,
      turnId: turn.turn_id,
      startMs,
      workerId: opts.owner,
    };

    try {
      await executeClaimedConversationTurn({
        deps: {
          tenantId: turn.tenant_id,
          approvalPollMs: runtime.approvalPollMs,
          db: runtime.opts.container.db,
          policyService: runtime.policyService,
          approvalDal: runtime.approvalDal,
          turnController: runtime.turnController,
          redactText: (text: string) =>
            runtime.opts.container.redactionEngine.redactText(text).redacted,
          redactUnknown: <T>(value: T) =>
            runtime.opts.container.redactionEngine.redactUnknown(value).redacted as T,
          isToolExecutionApprovalRequiredError: ((err: unknown) =>
            err instanceof
            ToolExecutionApprovalRequiredError) as TurnEngineBridgeDeps["isToolExecutionApprovalRequiredError"],
          executeTurn: async (request, turnOpts) =>
            await runtime.executeDecideAction(request, turnOpts),
        },
        request: loaded.request,
        prepared,
        runner,
        claimedTurn: turn,
      });
    } catch (error) {
      const status = await loadTurnStatus(opts.db, turn.turn_id);
      if (status === "succeeded" || status === "failed" || status === "cancelled") {
        return;
      }
      throw error;
    }
  }

  let stopping = false;
  const done = (async () => {
    opts.logger?.info?.("conversation.turn_loop.started", {
      owner: opts.owner,
      idle_sleep_ms: idleSleepMs,
      error_sleep_ms: errorSleepMs,
      max_ticks_per_cycle: maxTicksPerCycle,
    });

    for (;;) {
      if (stopping) break;
      try {
        let didWork = false;

        for (let i = 0; i < maxTicksPerCycle; i += 1) {
          if (stopping) break;

          const tenantIds = await listConversationTurnTenantIds(opts.db);
          let claimedTurn: TurnRunnerTurn | undefined;
          for (const tenantId of tenantIds) {
            if (
              await resolvePausedConversationTurn({
                runner,
                tenantId,
                db: opts.db,
                approvalDal: opts.approvalDal,
                turnController: opts.turnController,
              })
            ) {
              didWork = true;
              claimedTurn = undefined;
              break;
            }

            const now = new Date();
            const claimed = await runner.claimNextConversationTurn({
              tenantId,
              owner: opts.owner,
              nowMs: now.getTime(),
              nowIso: now.toISOString(),
              leaseTtlMs: TURN_RUNNER_LEASE_TTL_MS,
            });
            if (claimed?.kind === "claimed") {
              claimedTurn = claimed.turn;
              break;
            }
          }

          if (!claimedTurn) {
            if (!didWork) break;
            continue;
          }

          await processClaimedTurn(claimedTurn);
          didWork = true;
        }

        if (stopping) break;
        if (!didWork) {
          await sleep(idleSleepMs);
        } else {
          await sleep(0);
        }
      } catch (err) {
        const turnIdRaw =
          err && typeof err === "object"
            ? ((err as { turn_id?: unknown; turnId?: unknown }).turn_id ??
              (err as { turnId?: unknown }).turnId)
            : undefined;
        const turnId =
          typeof turnIdRaw === "string" && turnIdRaw.trim().length > 0
            ? turnIdRaw.trim()
            : undefined;
        const message = err instanceof Error ? err.message : String(err);
        opts.logger?.error?.("conversation.turn_loop.error", {
          owner: opts.owner,
          turn_id: turnId,
          error: message,
        });
        await sleep(errorSleepMs);
      }
    }

    opts.logger?.info?.("conversation.turn_loop.stopped", { owner: opts.owner });
  })();

  return {
    stop: () => {
      stopping = true;
    },
    done,
  };
}
