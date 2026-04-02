import type { AgentTurnResponse as AgentTurnResponseT, TyrumUIMessage } from "@tyrum/contracts";
import { AgentTurnResponse } from "@tyrum/contracts";
import { collectArtifactRefsFromMessages } from "../../ai-sdk/attachment-parts.js";
import { TurnItemDal } from "../turn-item-dal.js";
import { coerceRecord } from "../../util/coerce.js";
import type { TurnEngineBridgeDeps } from "./turn-engine-bridge.js";

function normalizeApprovalId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function textFromMessage(message: TyrumUIMessage): string {
  return message.parts
    .flatMap((part) =>
      part.type === "text" && typeof part["text"] === "string" ? [part["text"]] : [],
    )
    .join("\n\n")
    .trim();
}

function resolveAssistantReply(messages: readonly TyrumUIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const reply = textFromMessage(messages[index]!);
    if (reply.length > 0) {
      return reply;
    }
  }
  return "";
}

export async function loadTurnResult(
  deps: Pick<TurnEngineBridgeDeps, "db">,
  turnId: string,
): Promise<AgentTurnResponseT | undefined> {
  const row = await deps.db.get<{ result_json: string | null }>(
    `SELECT a.result_json
       FROM execution_attempts a
       JOIN execution_steps s ON s.step_id = a.step_id
       WHERE s.turn_id = ? AND a.result_json IS NOT NULL
       ORDER BY a.attempt DESC
       LIMIT 1`,
    [turnId],
  );
  if (row?.result_json) {
    try {
      return AgentTurnResponse.parse(JSON.parse(row.result_json));
    } catch {
      // Intentional: ignore malformed persisted JSON and fall back to other recovery paths.
    }
  }

  const turn = await deps.db.get<{
    tenant_id: string;
    conversation_key: string;
    conversation_id: string | null;
  }>(
    `SELECT r.tenant_id, r.conversation_key, j.conversation_id
       FROM turns r
       JOIN turn_jobs j ON j.tenant_id = r.tenant_id AND j.job_id = r.job_id
       WHERE r.turn_id = ?
       LIMIT 1`,
    [turnId],
  );
  if (!turn) return undefined;

  const messages = (
    await new TurnItemDal(deps.db).listByTurnId({
      tenantId: turn.tenant_id,
      turnId,
    })
  )
    .filter((item) => item.kind === "message")
    .map((item) => item.payload.message);
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  if (assistantMessages.length === 0) return undefined;

  const conversationId =
    turn.conversation_id ??
    (
      await deps.db.get<{ conversation_id: string }>(
        `SELECT conversation_id
           FROM conversations
           WHERE tenant_id = ? AND conversation_key = ?
           LIMIT 1`,
        [turn.tenant_id, turn.conversation_key],
      )
    )?.conversation_id;
  if (!conversationId) return undefined;

  return AgentTurnResponse.parse({
    reply: resolveAssistantReply(assistantMessages),
    turn_id: turnId,
    conversation_id: conversationId,
    conversation_key: turn.conversation_key,
    attachments: collectArtifactRefsFromMessages(assistantMessages),
  });
}

export async function loadTurnFailure(
  deps: Pick<TurnEngineBridgeDeps, "db">,
  turnId: string,
): Promise<string | undefined> {
  const row = await deps.db.get<{ error: string | null }>(
    `SELECT a.error
       FROM execution_attempts a
       JOIN execution_steps s ON s.step_id = a.step_id
       WHERE s.turn_id = ? AND a.error IS NOT NULL
       ORDER BY a.attempt DESC
       LIMIT 1`,
    [turnId],
  );
  const error = row?.error?.trim();
  return error && error.length > 0 ? error : undefined;
}

export async function maybeResolvePausedTurn(
  deps: Pick<TurnEngineBridgeDeps, "approvalDal" | "db" | "executionEngine">,
  turnId: string,
): Promise<boolean> {
  const pausedStep = await deps.db.get<{ tenant_id: string; approval_id: string | null }>(
    `SELECT tenant_id, approval_id
       FROM execution_steps
       WHERE turn_id = ? AND status = 'paused'
       ORDER BY step_index ASC
       LIMIT 1`,
    [turnId],
  );
  const pausedTurn = await deps.db.get<{ tenant_id: string; checkpoint_json: string | null }>(
    `SELECT tenant_id, checkpoint_json
       FROM turns
       WHERE turn_id = ? AND status = 'paused'`,
    [turnId],
  );
  let checkpoint: Record<string, unknown> | undefined;
  if (pausedTurn?.checkpoint_json) {
    try {
      checkpoint = coerceRecord(JSON.parse(pausedTurn.checkpoint_json)) ?? undefined;
    } catch {
      // Intentional: ignore malformed checkpoint JSON and fall back to execution-step state.
      checkpoint = undefined;
    }
  }
  const checkpointApprovalId =
    typeof checkpoint?.["resume_approval_id"] === "string"
      ? normalizeApprovalId(checkpoint["resume_approval_id"])
      : undefined;
  const approvalId = normalizeApprovalId(pausedStep?.approval_id) ?? checkpointApprovalId;
  const tenantId = pausedStep?.tenant_id ?? pausedTurn?.tenant_id;
  if (!tenantId || !approvalId) return false;

  await deps.approvalDal.expireStale({ tenantId });
  let approval = await deps.approvalDal.getById({ tenantId, approvalId });
  if (!approval) {
    await deps.executionEngine.cancelTurn(turnId, "approval record not found");
    return true;
  }

  const extractReason = (): string | undefined => {
    const reason = approval?.latest_review?.reason?.trim() ?? "";
    return reason.length > 0 ? reason : undefined;
  };

  if (
    approval.status === "queued" ||
    approval.status === "reviewing" ||
    approval.status === "awaiting_human"
  ) {
    const expiresAt = approval.expires_at;
    const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      approval =
        (await deps.approvalDal.expireById({ tenantId, approvalId: approval.approval_id })) ??
        approval;
    } else {
      return false;
    }
  }

  const ctx = coerceRecord(approval.context);
  const isAgentToolExecution = ctx?.["source"] === "agent-tool-execution";
  const resumeToken =
    approval.resume_token?.trim() ||
    (typeof ctx?.["resume_token"] === "string" ? ctx["resume_token"].trim() : "");

  if (approval.status === "approved" && !resumeToken) {
    await deps.executionEngine.cancelTurn(
      approval.turn_id ?? turnId,
      extractReason() ?? "approved approval missing resume token",
    );
    return true;
  }

  if (
    resumeToken &&
    (approval.status === "approved" ||
      (isAgentToolExecution && (approval.status === "denied" || approval.status === "expired")))
  ) {
    await deps.executionEngine.resumeTurn(resumeToken);
    return true;
  }

  if (approval.status === "denied" || approval.status === "expired") {
    const reason =
      extractReason() ?? (approval.status === "expired" ? "approval timed out" : "approval denied");
    await deps.executionEngine.cancelTurn(turnId, reason);
    return true;
  }

  if (approval.status === "cancelled") {
    await deps.executionEngine.cancelTurn(turnId, extractReason() ?? "approval cancelled");
    return true;
  }

  return false;
}
