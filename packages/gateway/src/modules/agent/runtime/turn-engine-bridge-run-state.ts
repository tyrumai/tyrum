import type { AgentTurnResponse as AgentTurnResponseT } from "@tyrum/schemas";
import { AgentTurnResponse } from "@tyrum/schemas";
import { coerceRecord } from "../../util/coerce.js";
import type { TurnEngineBridgeDeps } from "./turn-engine-bridge.js";

export async function loadTurnResultFromRun(
  deps: Pick<TurnEngineBridgeDeps, "db">,
  runId: string,
): Promise<AgentTurnResponseT | undefined> {
  const row = await deps.db.get<{ result_json: string | null }>(
    `SELECT a.result_json
       FROM execution_attempts a
       JOIN execution_steps s ON s.step_id = a.step_id
       WHERE s.run_id = ? AND a.result_json IS NOT NULL
       ORDER BY a.attempt DESC
       LIMIT 1`,
    [runId],
  );
  if (!row?.result_json) return undefined;

  try {
    return AgentTurnResponse.parse(JSON.parse(row.result_json));
  } catch {
    // Intentional: ignore malformed persisted JSON and fall back to other recovery paths.
    return undefined;
  }
}

export async function loadTurnFailureFromRun(
  deps: Pick<TurnEngineBridgeDeps, "db">,
  runId: string,
): Promise<string | undefined> {
  const row = await deps.db.get<{ error: string | null }>(
    `SELECT a.error
       FROM execution_attempts a
       JOIN execution_steps s ON s.step_id = a.step_id
       WHERE s.run_id = ? AND a.error IS NOT NULL
       ORDER BY a.attempt DESC
       LIMIT 1`,
    [runId],
  );
  const error = row?.error?.trim();
  return error && error.length > 0 ? error : undefined;
}

export async function maybeResolvePausedRun(
  deps: Pick<TurnEngineBridgeDeps, "approvalDal" | "db" | "executionEngine">,
  runId: string,
): Promise<boolean> {
  const pausedStep = await deps.db.get<{ tenant_id: string; approval_id: string | null }>(
    `SELECT tenant_id, approval_id
       FROM execution_steps
       WHERE run_id = ? AND status = 'paused'
       ORDER BY step_index ASC
       LIMIT 1`,
    [runId],
  );
  const approvalId = pausedStep?.approval_id ?? null;
  if (!pausedStep || approvalId === null) return false;
  const tenantId = pausedStep.tenant_id;

  await deps.approvalDal.expireStale({ tenantId });
  let approval = await deps.approvalDal.getById({ tenantId, approvalId });
  if (!approval) {
    await deps.executionEngine.cancelRun(runId, "approval record not found");
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
    await deps.executionEngine.cancelRun(
      approval.run_id ?? runId,
      extractReason() ?? "approved approval missing resume token",
    );
    return true;
  }

  if (
    resumeToken &&
    (approval.status === "approved" ||
      (isAgentToolExecution && (approval.status === "denied" || approval.status === "expired")))
  ) {
    await deps.executionEngine.resumeRun(resumeToken);
    return true;
  }

  if (approval.status === "denied" || approval.status === "expired") {
    const reason =
      extractReason() ?? (approval.status === "expired" ? "approval timed out" : "approval denied");
    await deps.executionEngine.cancelRun(runId, reason);
    return true;
  }

  if (approval.status === "cancelled") {
    await deps.executionEngine.cancelRun(runId, extractReason() ?? "approval cancelled");
    return true;
  }

  return false;
}
