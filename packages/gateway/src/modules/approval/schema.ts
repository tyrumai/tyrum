import { Approval, ApprovalKind, ApprovalSuggestedOverride } from "@tyrum/schemas";
import type {
  Approval as ApprovalT,
  ApprovalDecision,
  ApprovalKind as ApprovalKindT,
  ApprovalScope,
} from "@tyrum/schemas";
import type { ApprovalRow } from "./dal.js";

export function resumeTokenFromContext(context: unknown): string | undefined {
  if (!context || typeof context !== "object") return undefined;
  const token = (context as Record<string, unknown>)["resume_token"];
  return typeof token === "string" && token.trim().length > 0 ? token : undefined;
}

export function runIdFromContext(context: unknown): string | undefined {
  if (!context || typeof context !== "object") return undefined;
  const runId = (context as Record<string, unknown>)["run_id"];
  return typeof runId === "string" && runId.trim().length > 0 ? runId : undefined;
}

function toApprovalScope(
  row: Pick<ApprovalRow, "plan_id" | "step_index" | "context">,
): ApprovalScope | undefined {
  const scope: Record<string, unknown> = {};

  const ctx = row.context;
  if (ctx && typeof ctx === "object") {
    const record = ctx as Record<string, unknown>;
    if (typeof record["agent_id"] === "string") scope["agent_id"] = record["agent_id"];
    if (typeof record["key"] === "string") scope["key"] = record["key"];
    if (typeof record["lane"] === "string") scope["lane"] = record["lane"];
    if (typeof record["run_id"] === "string") scope["run_id"] = record["run_id"];
  }

  scope["step_index"] = row.step_index;

  return Object.keys(scope).length > 0 ? (scope as unknown as ApprovalScope) : undefined;
}

export function toSchemaApproval(row: ApprovalRow): ApprovalT {
  const ctx = row.context;
  let kind: ApprovalKindT = "other";
  if (ctx && typeof ctx === "object") {
    const rawKind = (ctx as Record<string, unknown>)["kind"];
    if (typeof rawKind === "string") {
      const parsed = ApprovalKind.safeParse(rawKind);
      if (parsed.success) {
        kind = parsed.data;
      }
    }
  }

  let suggestedOverrides: unknown = undefined;
  if (ctx && typeof ctx === "object") {
    suggestedOverrides = (ctx as Record<string, unknown>)["suggested_overrides"];
  }
  const suggestedParsed = suggestedOverrides
    ? ApprovalSuggestedOverride.array().max(10).safeParse(suggestedOverrides)
    : { success: false as const };

  const resolution =
    row.status === "pending"
      ? null
      : {
          decision:
            row.status === "approved"
              ? ("approved" as ApprovalDecision)
              : ("denied" as ApprovalDecision),
          resolved_at: row.responded_at ?? row.created_at,
          resolved_by: row.resolved_by ?? undefined,
          reason: row.response_reason ?? (row.status === "expired" ? "expired" : undefined),
          mode: row.status === "approved" ? row.response_mode ?? undefined : undefined,
          policy_override_id:
            row.status === "approved" ? row.policy_override_id ?? undefined : undefined,
        };

  return Approval.parse({
    approval_id: row.id,
    kind,
    status: row.status,
    prompt: row.prompt,
    context: row.context,
    scope: toApprovalScope(row),
    suggested_overrides: suggestedParsed.success ? suggestedParsed.data : undefined,
    created_at: row.created_at,
    expires_at: row.expires_at,
    resolution,
  });
}
