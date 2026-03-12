import type {
  PolicyOverride as PolicyOverrideT,
  PolicyOverrideStatus as PolicyOverrideStatusT,
  WsEventEnvelope,
} from "@tyrum/schemas";
import {
  PolicyOverride,
  canonicalizeToolId,
  isLegacyUmbrellaCapabilityDescriptorId,
} from "@tyrum/schemas";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../../statestore/types.js";
import { POLICY_WS_AUDIENCE } from "../../ws/audience.js";
import { enqueueWsBroadcastMessage } from "../../ws/outbox.js";

export interface PolicyOverrideRow extends PolicyOverrideT {}

interface RawPolicyOverrideRow {
  policy_override_id: string;
  status: string;
  created_at: string | Date;
  updated_at: string | Date;
  created_by_json: string;
  agent_id: string;
  workspace_id: string | null;
  tool_id: string;
  pattern: string;
  created_from_approval_id: string | null;
  created_from_policy_snapshot_id: string | null;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
  revoked_by_json: string | null;
  revoked_reason: string | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeMaybeTime(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function parseJsonOrEmpty(raw: string | null): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Intentional: treat invalid JSON columns as empty objects.
    return {};
  }
}

function normalizePolicyOverridePattern(toolId: string, pattern: string): string {
  const normalizedToolId = canonicalizeToolId(toolId);
  const trimmedPattern = pattern.trim();
  if (normalizedToolId !== "tool.node.dispatch" || trimmedPattern.length === 0) {
    return trimmedPattern;
  }

  const capabilityMarker = "capability:";
  const capabilityStart = trimmedPattern.indexOf(capabilityMarker);
  if (capabilityStart === -1) {
    return trimmedPattern;
  }

  const valueStart = capabilityStart + capabilityMarker.length;
  const delimiterIndex = trimmedPattern.indexOf(";", valueStart);
  const capabilityEnd = delimiterIndex === -1 ? trimmedPattern.length : delimiterIndex;
  const capabilityId = trimmedPattern.slice(valueStart, capabilityEnd).trim();
  if (!isLegacyUmbrellaCapabilityDescriptorId(capabilityId)) {
    return trimmedPattern;
  }

  return `${trimmedPattern.slice(0, valueStart)}${capabilityId}.*${trimmedPattern.slice(capabilityEnd)}`;
}

function toOverrideRow(raw: RawPolicyOverrideRow): PolicyOverrideRow {
  const status: PolicyOverrideStatusT =
    raw.status === "revoked" || raw.status === "expired" ? raw.status : "active";

  const expiresAt = normalizeMaybeTime(raw.expires_at) ?? undefined;
  const revokedAt = normalizeMaybeTime(raw.revoked_at) ?? undefined;

  return PolicyOverride.parse({
    policy_override_id: raw.policy_override_id,
    status,
    created_at: normalizeTime(raw.created_at),
    created_by: parseJsonOrEmpty(raw.created_by_json),
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id ?? undefined,
    tool_id: raw.tool_id,
    pattern: normalizePolicyOverridePattern(raw.tool_id, raw.pattern),
    created_from_approval_id: raw.created_from_approval_id ?? undefined,
    created_from_policy_snapshot_id: raw.created_from_policy_snapshot_id ?? undefined,
    expires_at: expiresAt ?? undefined,
    revoked_at: revokedAt ?? undefined,
    revoked_by: parseJsonOrEmpty(raw.revoked_by_json),
    revoked_reason: raw.revoked_reason ?? undefined,
  });
}

function isoNow(): string {
  return new Date().toISOString();
}

export class PolicyOverrideDal {
  constructor(private readonly db: SqlDb) {}

  async list(params: {
    tenantId: string;
    agentId?: string;
    toolId?: string;
    status?: PolicyOverrideStatusT;
    limit?: number;
  }): Promise<PolicyOverrideRow[]> {
    const where: string[] = [];
    const values: unknown[] = [params.tenantId];

    if (params.agentId) {
      where.push("agent_id = ?");
      values.push(params.agentId);
    }
    if (params.toolId) {
      where.push("tool_id = ?");
      values.push(canonicalizeToolId(params.toolId));
    }
    if (params.status) {
      where.push("status = ?");
      values.push(params.status);
    }

    const limit = Math.max(1, Math.min(500, params.limit ?? 100));
    const sql =
      `SELECT * FROM policy_overrides` +
      ` WHERE tenant_id = ?` +
      (where.length > 0 ? ` AND ${where.join(" AND ")}` : "") +
      ` ORDER BY created_at DESC` +
      ` LIMIT ?`;
    values.push(limit);

    const rows = await this.db.all<RawPolicyOverrideRow>(sql, values);
    return rows.map(toOverrideRow);
  }

  async getById(params: {
    tenantId: string;
    policyOverrideId: string;
  }): Promise<PolicyOverrideRow | undefined> {
    const row = await this.db.get<RawPolicyOverrideRow>(
      `SELECT * FROM policy_overrides WHERE tenant_id = ? AND policy_override_id = ?`,
      [params.tenantId, params.policyOverrideId],
    );
    return row ? toOverrideRow(row) : undefined;
  }

  async create(params: {
    tenantId: string;
    agentId: string;
    workspaceId?: string;
    toolId: string;
    pattern: string;
    createdBy?: unknown;
    createdFromApprovalId?: string;
    createdFromPolicySnapshotId?: string;
    expiresAt?: string | null;
  }): Promise<PolicyOverrideRow> {
    const id = randomUUID();
    const overrideKey = `override:${id}`;
    const nowIso = isoNow();
    const pattern = normalizePolicyOverridePattern(params.toolId, params.pattern);
    const row = await this.db.get<RawPolicyOverrideRow>(
      `INSERT INTO policy_overrides (
         tenant_id,
         policy_override_id,
         override_key,
         status,
         agent_id,
         workspace_id,
         tool_id,
         pattern,
         created_from_approval_id,
         created_from_policy_snapshot_id,
         created_by_json,
         expires_at,
         created_at,
         updated_at
      ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        params.tenantId,
        id,
        overrideKey,
        params.agentId,
        params.workspaceId ?? null,
        canonicalizeToolId(params.toolId),
        pattern,
        params.createdFromApprovalId ?? null,
        params.createdFromPolicySnapshotId ?? null,
        JSON.stringify(params.createdBy ?? {}),
        params.expiresAt ?? null,
        nowIso,
        nowIso,
      ],
    );
    if (!row) {
      throw new Error("policy override insert failed");
    }
    return toOverrideRow(row);
  }

  async revoke(params: {
    tenantId: string;
    policyOverrideId: string;
    revokedBy?: unknown;
    reason?: string;
  }): Promise<PolicyOverrideRow | undefined> {
    const nowIso = isoNow();
    const result = await this.db.run(
      `UPDATE policy_overrides
       SET status = 'revoked',
           revoked_at = ?,
           revoked_by_json = ?,
           revoked_reason = ?,
           updated_at = ?
       WHERE tenant_id = ?
         AND policy_override_id = ?
         AND status = 'active'`,
      [
        nowIso,
        JSON.stringify(params.revokedBy ?? {}),
        params.reason ?? null,
        nowIso,
        params.tenantId,
        params.policyOverrideId,
      ],
    );
    if (result.changes === 0) return undefined;
    return await this.getById({
      tenantId: params.tenantId,
      policyOverrideId: params.policyOverrideId,
    });
  }

  async expireStale(params: { tenantId: string; nowIso?: string }): Promise<PolicyOverrideRow[]> {
    const nowIso = params.nowIso ?? isoNow();
    return await this.db.transaction(async (tx) => {
      const rows = await tx.all<RawPolicyOverrideRow>(
        `UPDATE policy_overrides
         SET status = 'expired',
             updated_at = ?
         WHERE tenant_id = ?
           AND status = 'active'
           AND expires_at IS NOT NULL
           AND expires_at <= ?
         RETURNING *`,
        [nowIso, params.tenantId, nowIso],
      );
      if (rows.length === 0) return [];

      const overrides = rows.map(toOverrideRow);

      for (const override of overrides) {
        const evt: WsEventEnvelope = {
          event_id: randomUUID(),
          type: "policy_override.expired",
          occurred_at: nowIso,
          payload: { override },
        };
        await enqueueWsBroadcastMessage(tx, params.tenantId, evt, POLICY_WS_AUDIENCE);
      }

      return overrides;
    });
  }

  async listActiveForTool(params: {
    tenantId: string;
    agentId: string;
    workspaceId?: string;
    toolId: string;
  }): Promise<PolicyOverrideRow[]> {
    const nowIso = isoNow();
    await this.expireStale({ tenantId: params.tenantId, nowIso });

    const rows = await this.db.all<RawPolicyOverrideRow>(
      `SELECT *
       FROM policy_overrides
       WHERE tenant_id = ?
         AND status = 'active'
         AND agent_id = ?
         AND tool_id = ?
         AND (workspace_id IS NULL OR workspace_id = ?)
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC`,
      [params.tenantId, params.agentId, params.toolId, params.workspaceId ?? null, nowIso],
    );
    return rows.map(toOverrideRow);
  }
}
