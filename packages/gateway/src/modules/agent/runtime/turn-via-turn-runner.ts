import { randomUUID } from "node:crypto";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
} from "@tyrum/contracts";
import { createReviewedApproval } from "../../review/review-init.js";
import { coerceRecord } from "../../util/coerce.js";
import { ApprovalDal } from "../../approval/dal.js";
import { loadTurnResult, maybeResolvePausedTurn } from "./turn-engine-bridge-turn-state.js";
import type { TurnEngineBridgeDeps } from "./turn-engine-bridge.js";
import { prepareConversationTurnRun } from "./turn-engine-bridge-execution.js";
import { TurnRunner, type TurnRunnerTurn } from "./turn-runner.js";

export const TURN_RUNNER_LEASE_TTL_MS = 30_000;
const TURN_RUNNER_HEARTBEAT_MS = 5_000;

export type PreparedConversationTurnExecution = {
  planId: string;
  deadlineMs: number;
  key: string;
  turnId: string;
  startMs: number;
  workerId: string;
};

type TurnStatusRow = {
  status: string;
  blocked_reason: string | null;
  blocked_detail: string | null;
  checkpoint_json: string | null;
};

type ConversationTurnExecutionDeps = Pick<
  TurnEngineBridgeDeps,
  | "tenantId"
  | "approvalPollMs"
  | "db"
  | "policyService"
  | "approvalDal"
  | "executionEngine"
  | "redactText"
  | "redactUnknown"
  | "isToolExecutionApprovalRequiredError"
> & {
  executeTurn: (
    input: AgentTurnRequestT,
    opts?: {
      abortSignal?: AbortSignal;
      timeoutMs?: number;
      execution?: { planId: string; turnId: string; stepApprovalId?: string };
    },
  ) => Promise<AgentTurnResponseT>;
};

class TurnRunnerTerminalError extends Error {}

function approvalKeySuffix(context: unknown): string {
  const record = coerceRecord(context);
  const aiSdk = coerceRecord(record?.["ai_sdk"]);
  const approvalId = typeof aiSdk?.["approval_id"] === "string" ? aiSdk["approval_id"].trim() : "";
  return approvalId || randomUUID();
}

function checkpointApprovalId(checkpoint: unknown): string | undefined {
  const record = coerceRecord(checkpoint);
  const approvalId =
    typeof record?.["resume_approval_id"] === "string" ? record["resume_approval_id"].trim() : "";
  return approvalId.length > 0 ? approvalId : undefined;
}

function pauseReason(kind: string): string {
  if (kind === "budget") return "budget";
  if (kind === "policy") return "policy";
  return "approval";
}

function normalizeLegacyExecutionScope(context: unknown): Record<string, unknown> {
  const record = coerceRecord(context);
  const normalized = record ? { ...record } : {};
  const approvalStepIndex = normalized["approval_step_index"];
  const executionStepId = normalized["execution_step_id"];

  if (
    typeof normalized["step_index"] !== "number" &&
    typeof approvalStepIndex === "number" &&
    Number.isFinite(approvalStepIndex)
  ) {
    normalized["step_index"] = approvalStepIndex;
  }

  if (
    typeof normalized["step_id"] !== "string" &&
    typeof executionStepId === "string" &&
    executionStepId.trim().length > 0
  ) {
    normalized["step_id"] = executionStepId;
  }

  return normalized;
}

async function loadTurnStatus(
  deps: Pick<TurnEngineBridgeDeps, "db">,
  turnId: string,
): Promise<TurnStatusRow> {
  const row = await deps.db.get<TurnStatusRow>(
    `SELECT status, blocked_reason, blocked_detail, checkpoint_json
       FROM turns
       WHERE turn_id = ?`,
    [turnId],
  );
  if (!row) {
    throw new Error(`turn '${turnId}' not found`);
  }
  return row;
}

async function resolveSucceededTurn(
  deps: Pick<TurnEngineBridgeDeps, "db">,
  turnId: string,
): Promise<AgentTurnResponseT> {
  const persisted = await loadTurnResult(deps, turnId);
  if (persisted) {
    return persisted;
  }
  throw new Error("conversation turn completed without a result payload");
}

async function resolveTerminalTurn(
  deps: Pick<TurnEngineBridgeDeps, "db">,
  turnId: string,
  status: string,
  finalRun?: TurnStatusRow,
): Promise<AgentTurnResponseT> {
  if (status === "succeeded") {
    return await resolveSucceededTurn(deps, turnId);
  }
  if ((status === "cancelled" || status === "failed") && finalRun) {
    throw new TurnRunnerTerminalError(
      finalRun.blocked_detail ?? finalRun.blocked_reason ?? `turn ${status}`,
    );
  }

  throw new TurnRunnerTerminalError(`turn '${turnId}' became ${status}`);
}

async function createTurnApproval(input: {
  deps: ConversationTurnExecutionDeps;
  turnId: string;
  planId: string;
  key: string;
  pause: {
    kind: string;
    prompt: string;
    detail: string;
    context?: unknown;
    expiresAt?: string | null;
  };
}): Promise<{ approvalId: string }> {
  return await input.deps.db.transaction(async (tx) => {
    const job = await tx.get<{
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
      conversation_id: string | null;
    }>(
      `SELECT j.tenant_id, j.agent_id, j.workspace_id, j.conversation_id
         FROM turn_jobs j
         JOIN turns r ON r.tenant_id = j.tenant_id AND r.job_id = j.job_id
        WHERE r.turn_id = ?`,
      [input.turnId],
    );
    if (!job) {
      throw new Error(`turn job for '${input.turnId}' not found`);
    }

    const nowIso = new Date().toISOString();
    const resumeToken = `resume-${randomUUID()}`;
    await tx.run(
      `INSERT INTO resume_tokens (tenant_id, token, turn_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, token) DO NOTHING`,
      [job.tenant_id, resumeToken, input.turnId, nowIso],
    );

    const redactedDetail = input.deps.redactText(input.pause.detail);
    const redactedContext = input.deps.redactUnknown({
      ...normalizeLegacyExecutionScope(input.pause.context),
      resume_token: resumeToken,
      turn_id: input.turnId,
      plan_id: input.planId,
      conversation_key: input.key,
    });
    const approval = await createReviewedApproval({
      approvalDal: new ApprovalDal(tx),
      policyService: input.deps.policyService,
      params: {
        tenantId: job.tenant_id,
        agentId: job.agent_id,
        workspaceId: job.workspace_id,
        approvalKey: `agent-turn:${input.turnId}:approval:${approvalKeySuffix(input.pause.context)}`,
        prompt: input.pause.prompt,
        motivation: redactedDetail,
        kind: input.pause.kind as never,
        context: redactedContext,
        expiresAt: input.pause.expiresAt ?? null,
        conversationId: job.conversation_id ?? undefined,
        turnId: input.turnId,
        resumeToken,
      },
    });

    return { approvalId: approval.approval_id };
  });
}

function startHeartbeat(input: {
  deps: ConversationTurnExecutionDeps;
  runner: TurnRunner;
  turnId: string;
  owner: string;
}): () => void {
  const timer = setInterval(() => {
    const now = new Date();
    void input.runner.heartbeat({
      tenantId: input.deps.tenantId,
      turnId: input.turnId,
      owner: input.owner,
      nowMs: now.getTime(),
      nowIso: now.toISOString(),
      leaseTtlMs: TURN_RUNNER_LEASE_TTL_MS,
    });
  }, TURN_RUNNER_HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function executeClaimedConversationTurn(input: {
  deps: ConversationTurnExecutionDeps;
  request: AgentTurnRequestT;
  prepared: PreparedConversationTurnExecution;
  runner: TurnRunner;
  claimedTurn: TurnRunnerTurn;
  resumeApprovalId?: string;
}): Promise<
  { kind: "completed"; response: AgentTurnResponseT } | { kind: "paused"; resumeApprovalId: string }
> {
  const resumeApprovalId =
    input.resumeApprovalId ?? checkpointApprovalId(input.claimedTurn.checkpoint);
  const stopHeartbeat = startHeartbeat({
    deps: input.deps,
    runner: input.runner,
    turnId: input.prepared.turnId,
    owner: input.prepared.workerId,
  });
  const remainingMs = Math.max(1, input.prepared.deadlineMs - Date.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remainingMs);

  try {
    const response = await input.deps.executeTurn(input.request, {
      abortSignal: controller.signal,
      timeoutMs: remainingMs,
      execution: {
        planId: input.prepared.planId,
        turnId: input.prepared.turnId,
        stepApprovalId: resumeApprovalId,
      },
    });
    clearTimeout(timer);
    stopHeartbeat();
    const completed = await input.runner.complete({
      tenantId: input.deps.tenantId,
      turnId: input.prepared.turnId,
      owner: input.prepared.workerId,
      nowIso: new Date().toISOString(),
    });
    if (!completed) {
      const finalRun = await loadTurnStatus(input.deps, input.prepared.turnId);
      return {
        kind: "completed",
        response: await resolveTerminalTurn(
          input.deps,
          input.prepared.turnId,
          finalRun.status,
          finalRun,
        ),
      };
    }
    return { kind: "completed", response };
  } catch (error) {
    clearTimeout(timer);
    stopHeartbeat();
    if (error instanceof TurnRunnerTerminalError) {
      throw error;
    }
    if (input.deps.isToolExecutionApprovalRequiredError(error)) {
      const created = await createTurnApproval({
        deps: input.deps,
        turnId: input.prepared.turnId,
        planId: input.prepared.planId,
        key: input.prepared.key,
        pause: error.pause,
      });
      const paused = await input.runner.pause({
        tenantId: input.deps.tenantId,
        turnId: input.prepared.turnId,
        owner: input.prepared.workerId,
        nowIso: new Date().toISOString(),
        reason: pauseReason(error.pause.kind),
        detail: input.deps.redactText(error.pause.detail),
        checkpoint: { resume_approval_id: created.approvalId },
      });
      if (!paused) {
        throw new Error(`failed to pause conversation turn '${input.prepared.turnId}'`);
      }
      return { kind: "paused", resumeApprovalId: created.approvalId };
    }

    const message = error instanceof Error ? error.message : String(error);
    const failed = await input.runner.fail({
      tenantId: input.deps.tenantId,
      turnId: input.prepared.turnId,
      owner: input.prepared.workerId,
      nowIso: new Date().toISOString(),
      error: message,
    });
    if (!failed) {
      const finalRun = await loadTurnStatus(input.deps, input.prepared.turnId);
      return {
        kind: "completed",
        response: await resolveTerminalTurn(
          input.deps,
          input.prepared.turnId,
          finalRun.status,
          finalRun,
        ),
      };
    }
    throw error;
  }
}

export async function turnViaTurnRunner(
  deps: TurnEngineBridgeDeps,
  input: AgentTurnRequestT,
): Promise<AgentTurnResponseT> {
  const prepared = await prepareConversationTurnRun(deps, input, { steps: [] });
  const runner = new TurnRunner(deps.db);
  let resumeApprovalId: string | undefined;
  const executionDeps: ConversationTurnExecutionDeps = {
    tenantId: deps.tenantId,
    approvalPollMs: deps.approvalPollMs,
    db: deps.db,
    policyService: deps.policyService,
    approvalDal: deps.approvalDal,
    executionEngine: deps.executionEngine,
    redactText: deps.redactText,
    redactUnknown: deps.redactUnknown,
    isToolExecutionApprovalRequiredError: deps.isToolExecutionApprovalRequiredError,
    executeTurn: deps.turnDirect,
  };

  while (Date.now() < prepared.deadlineMs) {
    const now = new Date();
    const claimed = await runner.claim({
      tenantId: deps.tenantId,
      turnId: prepared.turnId,
      owner: prepared.workerId,
      nowMs: now.getTime(),
      nowIso: now.toISOString(),
      leaseTtlMs: TURN_RUNNER_LEASE_TTL_MS,
    });

    if (claimed.kind !== "claimed") {
      if (claimed.kind === "terminal") {
        const finalRun = await loadTurnStatus(deps, prepared.turnId);
        return await resolveTerminalTurn(deps, prepared.turnId, claimed.status, finalRun);
      }
      if (claimed.kind === "lease_unavailable") {
        const remainingMs = Math.max(1, prepared.deadlineMs - Date.now());
        await new Promise((resolve) => setTimeout(resolve, Math.min(25, remainingMs)));
        continue;
      }
      if (claimed.kind === "not_claimable" && claimed.status === "paused") {
        const resolvedPause = await maybeResolvePausedTurn(deps, prepared.turnId);
        if (!resolvedPause) {
          const remainingMs = Math.max(1, prepared.deadlineMs - Date.now());
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(deps.approvalPollMs, remainingMs)),
          );
        }
        continue;
      }
      throw new Error(`failed to claim conversation turn '${prepared.turnId}': ${claimed.kind}`);
    }

    const outcome = await executeClaimedConversationTurn({
      deps: executionDeps,
      request: input,
      prepared,
      runner,
      claimedTurn: claimed.turn,
      resumeApprovalId,
    });
    if (outcome.kind === "completed") {
      return outcome.response;
    }
    resumeApprovalId = outcome.resumeApprovalId;
  }

  const finalRun = await loadTurnStatus(deps, prepared.turnId);
  if (finalRun.status === "succeeded") {
    return await resolveSucceededTurn(deps, prepared.turnId);
  }
  if (finalRun.status === "cancelled" || finalRun.status === "failed") {
    throw new Error(
      finalRun.blocked_detail ?? finalRun.blocked_reason ?? `turn ${finalRun.status}`,
    );
  }

  const timeoutMessage = `conversation turn '${prepared.turnId}' did not complete within ${String(
    Math.max(0, Date.now() - prepared.startMs),
  )}ms`;
  await deps.executionEngine.cancelTurn(prepared.turnId, timeoutMessage);
  throw new Error(timeoutMessage);
}
