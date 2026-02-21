import { randomUUID } from "node:crypto";
import { ApprovalSuggestedOverride } from "@tyrum/schemas";
import type { ApprovalOverrideSelection, WsEventEnvelope } from "@tyrum/schemas";
import type { ExecutionEngine } from "../execution/engine.js";
import type { Logger } from "../observability/logger.js";
import { ApprovalDal, type ApprovalDal as ApprovalDalT, type ApprovalMode, type ApprovalRow } from "./dal.js";
import { runIdFromContext, resumeTokenFromContext, toSchemaApproval } from "./schema.js";
import { PolicyOverrideDal } from "../policy-overrides/dal.js";
import { toSchemaPolicyOverride } from "../policy-overrides/schema.js";

export interface WsEventPublisher {
  publish(evt: WsEventEnvelope, opts?: { targetRole?: "client" | "node" }): void;
}

export type ResolveAndApplyApprovalResult =
  | { kind: "not_found" }
  | { kind: "invalid_request"; message: string }
  | { kind: "conflict"; approval: ApprovalRow }
  | {
      kind: "ok";
      approval: ApprovalRow;
      applied: { resumed_run_id?: string; cancelled_run_id?: string };
    }
  | { kind: "pending"; approval: ApprovalRow };

export async function resolveAndApplyApproval(opts: {
  approvalDal: ApprovalDalT;
  executionEngine?: Pick<ExecutionEngine, "resumeRun" | "cancelRunByResumeToken">;
  wsPublisher?: WsEventPublisher;
  logger?: Logger;
  approvalId: number;
  decision: "approved" | "denied";
  reason?: string;
  mode?: ApprovalMode;
  selectedOverride?: ApprovalOverrideSelection;
  resolvedBy?: unknown;
}): Promise<ResolveAndApplyApprovalResult> {
  const approved = opts.decision === "approved";
  const mode = opts.mode ?? "once";
  const resolvedBy = opts.resolvedBy;
  const wantsAlways = approved && mode === "always";

  if (wantsAlways && !opts.selectedOverride) {
    return { kind: "invalid_request", message: "selected_override is required for mode=always" };
  }

  const { updated, createdOverride, invalidMessage } = wantsAlways
    ? await resolveApprovalWithPolicyOverride({
        approvalDal: opts.approvalDal,
        approvalId: opts.approvalId,
        reason: opts.reason,
        selectedOverride: opts.selectedOverride,
        resolvedBy,
      })
    : {
        updated:
          (await opts.approvalDal.respond(opts.approvalId, approved, opts.reason, {
            resolvedBy,
          })) ?? (await opts.approvalDal.getById(opts.approvalId)),
        createdOverride: undefined,
        invalidMessage: undefined,
      };

  if (invalidMessage) {
    return { kind: "invalid_request", message: invalidMessage };
  }

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

    if (createdOverride) {
      opts.wsPublisher.publish(
        {
          event_id: randomUUID(),
          type: "policy_override.created",
          occurred_at: nowIso,
          payload: { policy_override: toSchemaPolicyOverride(createdOverride) },
        },
        { targetRole: "client" },
      );
    }

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

async function resolveApprovalWithPolicyOverride(opts: {
  approvalDal: ApprovalDalT;
  approvalId: number;
  reason?: string;
  selectedOverride?: ApprovalOverrideSelection;
  resolvedBy?: unknown;
}): Promise<{
  updated: ApprovalRow | undefined;
  createdOverride: Awaited<ReturnType<PolicyOverrideDal["create"]>> | undefined;
  invalidMessage?: string;
}> {
  if (!opts.selectedOverride) {
    return {
      updated: await opts.approvalDal.getById(opts.approvalId),
      createdOverride: undefined,
      invalidMessage: "selected_override is required for mode=always",
    };
  }

  const policyOverrideId = `pov-${randomUUID()}`;
  const nowIso = new Date().toISOString();

  let createdOverride:
    | Awaited<ReturnType<PolicyOverrideDal["create"]>>
    | undefined;

  const updated = await opts.approvalDal.transaction(async (tx) => {
    const approvalDal = new ApprovalDal(tx);
    const overrideDal = new PolicyOverrideDal(tx);

    const current = await approvalDal.getById(opts.approvalId);
    if (!current) return undefined;
    if (current.status !== "pending") return current;

    const suggestion = pickSuggestedOverride(current.context, opts.selectedOverride!);
    if (!suggestion) return current;
    if (!suggestion.agent_id) return current;

    const policySnapshotId = policySnapshotIdFromContext(current.context);

    const resolved = await approvalDal.respond(opts.approvalId, true, opts.reason, {
      mode: "always",
      policyOverrideId,
      resolvedBy: opts.resolvedBy,
    });
    if (!resolved) {
      return (await approvalDal.getById(opts.approvalId)) ?? current;
    }

    createdOverride = await overrideDal.create({
      policyOverrideId,
      agentId: suggestion.agent_id,
      workspaceId: suggestion.workspace_id ?? null,
      toolId: suggestion.tool_id,
      pattern: suggestion.pattern,
      createdAt: nowIso,
      createdBy: opts.resolvedBy,
      createdFromApprovalId: opts.approvalId,
      createdFromPolicySnapshotId: policySnapshotId,
    });

    return resolved;
  });

  const invalidMessage =
    updated && updated.status === "pending"
      ? "selected_override is invalid, or the approval does not include suggested_overrides with agent scope"
      : undefined;

  return { updated, createdOverride, invalidMessage };
}

function policySnapshotIdFromContext(context: unknown): string | undefined {
  if (!context || typeof context !== "object") return undefined;
  const raw = (context as Record<string, unknown>)["policy_snapshot_id"];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : undefined;
}

function pickSuggestedOverride(
  context: unknown,
  selection: ApprovalOverrideSelection,
): { tool_id: string; pattern: string; agent_id?: string; workspace_id?: string } | undefined {
  if (!context || typeof context !== "object") return undefined;
  const raw = (context as Record<string, unknown>)["suggested_overrides"];
  const parsed = ApprovalSuggestedOverride.array().safeParse(raw);
  if (!parsed.success) return undefined;

  return parsed.data.find(
    (s) => s.tool_id === selection.tool_id && s.pattern === selection.pattern,
  );
}
