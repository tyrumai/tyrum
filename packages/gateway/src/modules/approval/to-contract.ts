import { Approval, ApprovalKind, ApprovalStatus, Lane, TyrumKey } from "@tyrum/schemas";
import type { Approval as ApprovalT, ApprovalResolution as ApprovalResolutionT } from "@tyrum/schemas";
import type { ApprovalRow } from "./dal.js";

function normalizeSqliteDateTime(value: string): string {
  // SQLite `datetime('now')` format: "YYYY-MM-DD HH:MM:SS" (UTC).
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return `${value.replace(" ", "T")}Z`;
  }
  return value;
}

function toIso(value: string | null): string | null {
  if (value === null) return null;
  return normalizeSqliteDateTime(value);
}

function normalizeKind(raw: string): ApprovalT["kind"] {
  const parsed = ApprovalKind.safeParse(raw);
  return parsed.success ? parsed.data : "other";
}

function normalizeStatus(raw: string): ApprovalT["status"] {
  const parsed = ApprovalStatus.safeParse(raw);
  return parsed.success ? parsed.data : "pending";
}

function buildResolution(
  status: ApprovalT["status"],
  createdAt: string,
  respondedAt: string | null,
  responseReason: string | null,
): ApprovalResolutionT | null {
  if (status === "pending") return null;

  return {
    decision: status === "approved" ? "approved" : "denied",
    resolved_at: respondedAt ?? createdAt,
    reason:
      responseReason ??
      (status === "expired" ? "expired" : status === "cancelled" ? "cancelled" : undefined),
  };
}

function buildScope(row: ApprovalRow): ApprovalT["scope"] | undefined {
  const scope: Record<string, unknown> = {};

  if (row.agent_id && row.agent_id.trim().length > 0) {
    scope["agent_id"] = row.agent_id;
  }
  if (row.run_id && row.run_id.trim().length > 0) {
    scope["run_id"] = row.run_id;
  }
  if (Number.isFinite(row.step_index)) {
    scope["step_index"] = row.step_index;
  }

  if (row.key) {
    const keyParsed = TyrumKey.safeParse(row.key);
    if (keyParsed.success) scope["key"] = keyParsed.data;
  }
  if (row.lane) {
    const laneParsed = Lane.safeParse(row.lane);
    if (laneParsed.success) scope["lane"] = laneParsed.data;
  }

  return Object.keys(scope).length > 0 ? (scope as ApprovalT["scope"]) : undefined;
}

export function toApprovalContract(row: ApprovalRow): ApprovalT | undefined {
  const status = normalizeStatus(row.status);
  const createdAt = normalizeSqliteDateTime(row.created_at);
  const respondedAt = toIso(row.responded_at);
  const expiresAt = toIso(row.expires_at);

  const candidate: ApprovalT = {
    approval_id: row.id,
    kind: normalizeKind(row.kind),
    status,
    prompt: row.prompt,
    context: row.context,
    scope: buildScope(row),
    created_at: createdAt,
    expires_at: expiresAt,
    resolution: buildResolution(status, createdAt, respondedAt, row.response_reason),
  };

  const parsed = Approval.safeParse(candidate);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

