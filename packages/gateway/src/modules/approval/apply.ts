import { randomUUID } from "node:crypto";
import type { WsEventEnvelope } from "@tyrum/schemas";
import type { ExecutionEngine } from "../execution/engine.js";
import type { Logger } from "../observability/logger.js";
import type { ApprovalDal, ApprovalRow } from "./dal.js";
import { runIdFromContext, resumeTokenFromContext, toSchemaApproval } from "./schema.js";

export interface WsEventPublisher {
  publish(evt: WsEventEnvelope, opts?: { targetRole?: "client" | "node" }): void;
}

export type ResolveAndApplyApprovalResult =
  | { kind: "not_found" }
  | { kind: "conflict"; approval: ApprovalRow }
  | {
      kind: "ok";
      approval: ApprovalRow;
      applied: { resumed_run_id?: string; cancelled_run_id?: string };
    }
  | { kind: "pending"; approval: ApprovalRow };

export async function resolveAndApplyApproval(opts: {
  approvalDal: ApprovalDal;
  executionEngine?: Pick<ExecutionEngine, "resumeRun" | "cancelRunByResumeToken">;
  wsPublisher?: WsEventPublisher;
  logger?: Logger;
  approvalId: number;
  decision: "approved" | "denied";
  reason?: string;
}): Promise<ResolveAndApplyApprovalResult> {
  const approved = opts.decision === "approved";

  const updated =
    (await opts.approvalDal.respond(opts.approvalId, approved, opts.reason)) ??
    (await opts.approvalDal.getById(opts.approvalId));

  if (!updated) {
    return { kind: "not_found" };
  }

  if (updated.status === "pending") {
    return { kind: "pending", approval: updated };
  }

  const currentDecision: "approved" | "denied" =
    updated.status === "approved" ? "approved" : "denied";
  if (currentDecision !== opts.decision) {
    return { kind: "conflict", approval: updated };
  }

  const applied: { resumed_run_id?: string; cancelled_run_id?: string } = {};

  const resumeToken = resumeTokenFromContext(updated.context);
  if (resumeToken && opts.executionEngine) {
    try {
      if (currentDecision === "approved") {
        const resumed = await opts.executionEngine.resumeRun(resumeToken);
        if (resumed) applied.resumed_run_id = resumed;
      } else {
        const cancelled = await opts.executionEngine.cancelRunByResumeToken(
          resumeToken,
          opts.reason,
        );
        if (cancelled) applied.cancelled_run_id = cancelled;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.logger?.error("approval.apply_failed", {
        approval_id: opts.approvalId,
        decision: currentDecision,
        error: message,
      });
    }
  }

  if (opts.wsPublisher) {
    const nowIso = new Date().toISOString();

    opts.wsPublisher.publish(
      {
        event_id: randomUUID(),
        type: "approval.resolved",
        occurred_at: nowIso,
        payload: { approval: toSchemaApproval(updated) },
      },
      { targetRole: "client" },
    );

    const runId = runIdFromContext(updated.context);
    const effectiveRunId =
      currentDecision === "approved"
        ? applied.resumed_run_id ?? runId
        : applied.cancelled_run_id ?? runId;

    if (effectiveRunId) {
      if (currentDecision === "approved") {
        opts.wsPublisher.publish(
          {
            event_id: randomUUID(),
            type: "run.resumed",
            occurred_at: nowIso,
            payload: { run_id: effectiveRunId },
          },
          { targetRole: "client" },
        );
      } else {
        opts.wsPublisher.publish(
          {
            event_id: randomUUID(),
            type: "run.cancelled",
            occurred_at: nowIso,
            payload: { run_id: effectiveRunId, reason: opts.reason },
          },
          { targetRole: "client" },
        );
      }
    }
  }

  return { kind: "ok", approval: updated, applied };
}

