import { Approval } from "@tyrum/schemas";
import type { Approval as ApprovalT } from "@tyrum/schemas";
import type { ApprovalRow } from "./dal.js";

export function toApprovalContract(row: ApprovalRow): ApprovalT | undefined {
  const candidate: ApprovalT = {
    approval_id: row.approval_id,
    approval_key: row.approval_key,
    kind: row.kind,
    status: row.status,
    prompt: row.prompt,
    motivation: row.motivation,
    context: row.context,
    scope: {
      ...(row.run_id ? { run_id: row.run_id } : {}),
      ...(row.step_id ? { step_id: row.step_id } : {}),
      ...(row.attempt_id ? { attempt_id: row.attempt_id } : {}),
      ...(row.work_item_id ? { work_item_id: row.work_item_id } : {}),
      ...(row.work_item_task_id ? { work_item_task_id: row.work_item_task_id } : {}),
    },
    created_at: row.created_at,
    expires_at: row.expires_at,
    latest_review: row.latest_review,
    ...(row.reviews ? { reviews: row.reviews } : {}),
  };

  const parsed = Approval.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
