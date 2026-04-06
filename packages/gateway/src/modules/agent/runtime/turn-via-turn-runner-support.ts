import { randomUUID } from "node:crypto";
import type {
  AgentTurnRequest as AgentTurnRequestT,
  AgentTurnResponse as AgentTurnResponseT,
} from "@tyrum/contracts";
import { createReviewedApproval } from "../../review/review-init.js";
import { ApprovalDal } from "../../approval/dal.js";
import { loadTurnResult } from "./turn-engine-bridge-turn-state.js";
import type { TurnEngineBridgeDeps } from "./turn-engine-bridge.js";
import { TurnRunner } from "./turn-runner.js";
import {
  approvalKeySuffix,
  normalizeLegacyExecutionScope,
  persistApprovalTurnItem,
} from "./turn-via-turn-runner-approval.js";

export type TurnStatusRow = {
  status: string;
  blocked_reason: string | null;
  blocked_detail: string | null;
  checkpoint_json: string | null;
};

export type ConversationTurnExecutionDeps = Pick<
  TurnEngineBridgeDeps,
  | "tenantId"
  | "approvalPollMs"
  | "db"
  | "policyService"
  | "approvalDal"
  | "turnController"
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

export class TurnRunnerTerminalError extends Error {}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadTurnStatus(
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

export async function resolveSucceededTurn(
  deps: Pick<TurnEngineBridgeDeps, "db">,
  turnId: string,
): Promise<AgentTurnResponseT> {
  const persisted = await loadTurnResult(deps, turnId);
  if (persisted) {
    return persisted;
  }
  throw new Error("conversation turn completed without a result payload");
}

export async function resolveTerminalTurn(
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

export async function createTurnApproval(input: {
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
    await persistApprovalTurnItem({
      tx,
      tenantId: job.tenant_id,
      approval,
      turnId: input.turnId,
    });

    return { approvalId: approval.approval_id };
  });
}

export function startHeartbeat(input: {
  deps: ConversationTurnExecutionDeps;
  runner: TurnRunner;
  turnId: string;
  owner: string;
  heartbeatMs: number;
  leaseTtlMs: number;
}): () => void {
  const timer = setInterval(() => {
    const now = new Date();
    void input.runner.heartbeat({
      tenantId: input.deps.tenantId,
      turnId: input.turnId,
      owner: input.owner,
      nowMs: now.getTime(),
      nowIso: now.toISOString(),
      leaseTtlMs: input.leaseTtlMs,
    });
  }, input.heartbeatMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
