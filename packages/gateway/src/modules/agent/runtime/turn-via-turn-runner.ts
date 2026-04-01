import { randomUUID } from "node:crypto";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
} from "@tyrum/contracts";
import { coerceRecord } from "../../util/coerce.js";
import { ApprovalDal } from "../../approval/dal.js";
import { maybeResolvePausedTurn } from "./turn-engine-bridge-turn-state.js";
import type { TurnEngineBridgeDeps } from "./turn-engine-bridge.js";
import { prepareConversationTurnRun } from "./turn-engine-bridge-execution.js";
import { TurnRunner } from "./turn-runner.js";

const TURN_RUNNER_LEASE_TTL_MS = 30_000;
const TURN_RUNNER_HEARTBEAT_MS = 5_000;

type TurnStatusRow = {
  status: string;
  blocked_reason: string | null;
  blocked_detail: string | null;
  checkpoint_json: string | null;
};

function approvalKeySuffix(context: unknown): string {
  const record = coerceRecord(context);
  const aiSdk = coerceRecord(record?.["ai_sdk"]);
  const approvalId = typeof aiSdk?.["approval_id"] === "string" ? aiSdk["approval_id"].trim() : "";
  return approvalId || randomUUID();
}

function pauseReason(kind: string): string {
  if (kind === "budget") return "budget";
  if (kind === "policy") return "policy";
  return "approval";
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

async function createTurnApproval(input: {
  deps: TurnEngineBridgeDeps;
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

    const resumeToken = `resume-${randomUUID()}`;
    await tx.run(
      `INSERT INTO resume_tokens (tenant_id, token, turn_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, token) DO NOTHING`,
      [job.tenant_id, resumeToken, input.turnId, new Date().toISOString()],
    );

    const redactedDetail = input.deps.redactText(input.pause.detail);
    const redactedContext = input.deps.redactUnknown({
      ...coerceRecord(input.pause.context),
      resume_token: resumeToken,
      turn_id: input.turnId,
      plan_id: input.planId,
      conversation_key: input.key,
    });
    const approval = await new ApprovalDal(tx).create({
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
    });

    return { approvalId: approval.approval_id };
  });
}

function startHeartbeat(input: {
  deps: TurnEngineBridgeDeps;
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

export async function turnViaTurnRunner(
  deps: TurnEngineBridgeDeps,
  input: AgentTurnRequestT,
): Promise<AgentTurnResponseT> {
  const prepared = await prepareConversationTurnRun(deps, input, { steps: [] });
  const runner = new TurnRunner(deps.db);
  let resumeApprovalId: string | undefined;

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
        throw new Error(`turn '${prepared.turnId}' became ${claimed.status}`);
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

    const stopHeartbeat = startHeartbeat({
      deps,
      runner,
      turnId: prepared.turnId,
      owner: prepared.workerId,
    });
    const remainingMs = Math.max(1, prepared.deadlineMs - Date.now());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);

    try {
      const response = await deps.turnDirect(input, {
        abortSignal: controller.signal,
        timeoutMs: remainingMs,
        execution: {
          planId: prepared.planId,
          turnId: prepared.turnId,
          stepApprovalId: resumeApprovalId,
        },
      });
      clearTimeout(timer);
      stopHeartbeat();
      await runner.complete({
        tenantId: deps.tenantId,
        turnId: prepared.turnId,
        owner: prepared.workerId,
        nowIso: new Date().toISOString(),
      });
      return response;
    } catch (error) {
      clearTimeout(timer);
      stopHeartbeat();
      if (deps.isToolExecutionApprovalRequiredError(error)) {
        const created = await createTurnApproval({
          deps,
          turnId: prepared.turnId,
          planId: prepared.planId,
          key: prepared.key,
          pause: error.pause,
        });
        resumeApprovalId = created.approvalId;
        const paused = await runner.pause({
          tenantId: deps.tenantId,
          turnId: prepared.turnId,
          owner: prepared.workerId,
          nowIso: new Date().toISOString(),
          reason: pauseReason(error.pause.kind),
          detail: deps.redactText(error.pause.detail),
          checkpoint: { resume_approval_id: created.approvalId },
        });
        if (!paused) {
          throw new Error(`failed to pause conversation turn '${prepared.turnId}'`);
        }
        continue;
      }

      const message = error instanceof Error ? error.message : String(error);
      await runner.fail({
        tenantId: deps.tenantId,
        turnId: prepared.turnId,
        owner: prepared.workerId,
        nowIso: new Date().toISOString(),
        error: message,
      });
      throw error;
    }
  }

  const finalRun = await loadTurnStatus(deps, prepared.turnId);
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
