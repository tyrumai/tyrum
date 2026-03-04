import {
  Approval,
  ApprovalKind,
  ApprovalResolution,
  ApprovalStatus,
  Lane,
  TyrumKey,
} from "@tyrum/schemas";
import type {
  Approval as ApprovalT,
  ApprovalResolution as ApprovalResolutionT,
} from "@tyrum/schemas";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import type { ApprovalRow } from "./dal.js";

function toIso(value: string | null): string | null {
  return normalizeDbDateTime(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeKind(raw: string): ApprovalT["kind"] {
  const parsed = ApprovalKind.safeParse(raw);
  return parsed.success ? parsed.data : "other";
}

function normalizeStatus(raw: string): ApprovalT["status"] {
  const parsed = ApprovalStatus.safeParse(raw);
  return parsed.success ? parsed.data : "pending";
}

function buildResolution(row: ApprovalRow, createdAt: string): ApprovalResolutionT | null {
  const status = normalizeStatus(row.status);
  if (status === "pending") return null;

  const parsed = ApprovalResolution.safeParse(row.resolution ?? null);
  if (parsed.success) {
    return parsed.data;
  }

  return {
    decision: status === "approved" ? "approved" : "denied",
    resolved_at: toIso(row.resolved_at) ?? createdAt,
    reason: status === "expired" ? "expired" : status === "cancelled" ? "cancelled" : undefined,
  };
}

function buildScope(row: ApprovalRow): ApprovalT["scope"] | undefined {
  const scope: Record<string, unknown> = {};

  if (row.run_id && row.run_id.trim().length > 0) {
    scope["run_id"] = row.run_id;
  }
  if (row.step_id && row.step_id.trim().length > 0) {
    scope["step_id"] = row.step_id;
  }
  if (row.attempt_id && row.attempt_id.trim().length > 0) {
    scope["attempt_id"] = row.attempt_id;
  }
  if (row.work_item_id && row.work_item_id.trim().length > 0) {
    scope["work_item_id"] = row.work_item_id;
  }
  if (row.work_item_task_id && row.work_item_task_id.trim().length > 0) {
    scope["work_item_task_id"] = row.work_item_task_id;
  }

  const ctx = row.context;
  if (isObject(ctx)) {
    const key = ctx["key"];
    if (typeof key === "string") {
      const parsed = TyrumKey.safeParse(key);
      if (parsed.success) scope["key"] = parsed.data;
    }
    const lane = ctx["lane"];
    if (typeof lane === "string") {
      const parsed = Lane.safeParse(lane);
      if (parsed.success) scope["lane"] = parsed.data;
    }
  }

  return Object.keys(scope).length > 0 ? (scope as ApprovalT["scope"]) : undefined;
}

export function toApprovalContract(row: ApprovalRow): ApprovalT | undefined {
  const status = normalizeStatus(row.status);
  const createdAt = normalizeDbDateTime(row.created_at);
  const expiresAt = toIso(row.expires_at);

  const candidate: ApprovalT = {
    approval_id: row.approval_id,
    approval_key: row.approval_key,
    kind: normalizeKind(row.kind),
    status,
    prompt: row.prompt,
    context: row.context,
    scope: buildScope(row),
    created_at: createdAt,
    expires_at: expiresAt,
    resolution: buildResolution(row, createdAt),
  };

  const parsed = Approval.safeParse(candidate);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}
