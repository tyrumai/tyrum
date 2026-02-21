import { PolicyOverride, PolicyOverrideStatus } from "@tyrum/schemas";
import type { PolicyOverride as PolicyOverrideT } from "@tyrum/schemas";
import type { PolicyOverrideRow } from "./dal.js";

function normalizeStatus(status: string): "active" | "revoked" | "expired" {
  const parsed = PolicyOverrideStatus.safeParse(status);
  if (parsed.success) return parsed.data;
  return "active";
}

export function toSchemaPolicyOverride(row: PolicyOverrideRow): PolicyOverrideT {
  return PolicyOverride.parse({
    policy_override_id: row.policy_override_id,
    status: normalizeStatus(row.status),
    created_at: row.created_at,
    created_by: row.created_by ?? undefined,
    agent_id: row.agent_id,
    workspace_id: row.workspace_id,
    tool_id: row.tool_id,
    pattern: row.pattern,
    created_from_approval_id: row.created_from_approval_id,
    created_from_policy_snapshot_id: row.created_from_policy_snapshot_id,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    revoked_by: row.revoked_by ?? undefined,
    revoked_reason: row.revoked_reason,
  });
}

