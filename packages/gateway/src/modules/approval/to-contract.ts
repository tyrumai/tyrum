import { AgentId, Approval, Lane, TyrumKey } from "@tyrum/contracts";
import type { Approval as ApprovalT } from "@tyrum/contracts";
import type { ApprovalRow } from "./dal.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function buildScope(row: ApprovalRow): ApprovalT["scope"] | undefined {
  const scope: Record<string, unknown> = {};

  if (row.run_id) scope["run_id"] = row.run_id;
  if (row.step_id) scope["step_id"] = row.step_id;
  if (row.attempt_id) scope["attempt_id"] = row.attempt_id;
  if (row.work_item_id) scope["work_item_id"] = row.work_item_id;
  if (row.work_item_task_id) scope["work_item_task_id"] = row.work_item_task_id;

  if (isObject(row.context)) {
    const key = row.context["key"];
    if (typeof key === "string") {
      const parsed = TyrumKey.safeParse(key);
      if (parsed.success) scope["key"] = parsed.data;
    }

    const lane = row.context["lane"];
    if (typeof lane === "string") {
      const parsed = Lane.safeParse(lane);
      if (parsed.success) scope["lane"] = parsed.data;
    }
  }

  return Object.keys(scope).length > 0 ? (scope as ApprovalT["scope"]) : undefined;
}

export function toApprovalContract(row: ApprovalRow): ApprovalT | undefined {
  const scope = buildScope(row);
  const agentId = AgentId.safeParse(row.agent_id);
  const candidate: ApprovalT = {
    approval_id: row.approval_id,
    approval_key: row.approval_key,
    ...(agentId.success ? { agent_id: agentId.data } : {}),
    kind: row.kind,
    status: row.status,
    prompt: row.prompt,
    motivation: row.motivation,
    context: row.context,
    ...(scope ? { scope } : {}),
    created_at: row.created_at,
    expires_at: row.expires_at,
    latest_review: row.latest_review,
    ...(row.reviews ? { reviews: row.reviews } : {}),
  };

  const parsed = Approval.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
