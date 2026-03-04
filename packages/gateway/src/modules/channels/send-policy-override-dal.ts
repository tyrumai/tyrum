import type { SqlDb } from "../../statestore/types.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";

export type SessionSendPolicyOverrideRow = {
  key: string;
  send_policy: "on" | "off";
  updated_at_ms: number;
};

type RawSessionSendPolicyOverrideRow = {
  key: string;
  send_policy: string;
  updated_at_ms: number | string;
};

function asNumber(value: number | string): number {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class SessionSendPolicyOverrideDal {
  constructor(private readonly db: SqlDb) {}

  async get(input: {
    tenant_id?: string;
    key: string;
  }): Promise<SessionSendPolicyOverrideRow | undefined> {
    const tenantId = input.tenant_id?.trim() || DEFAULT_TENANT_ID;
    const row = await this.db.get<RawSessionSendPolicyOverrideRow>(
      `SELECT key, send_policy, updated_at_ms
       FROM session_send_policy_overrides
       WHERE tenant_id = ? AND key = ?`,
      [tenantId, input.key],
    );
    if (!row) return undefined;
    const sendPolicy =
      row.send_policy === "on" ? "on" : row.send_policy === "off" ? "off" : undefined;
    if (!sendPolicy) return undefined;
    return {
      key: row.key,
      send_policy: sendPolicy,
      updated_at_ms: asNumber(row.updated_at_ms),
    };
  }

  async upsert(input: {
    tenant_id?: string;
    key: string;
    sendPolicy: "on" | "off";
  }): Promise<SessionSendPolicyOverrideRow> {
    const tenantId = input.tenant_id?.trim() || DEFAULT_TENANT_ID;
    const nowMs = Date.now();
    await this.db.run(
      `INSERT INTO session_send_policy_overrides (tenant_id, key, send_policy, updated_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (tenant_id, key) DO UPDATE SET
         send_policy = excluded.send_policy,
         updated_at_ms = excluded.updated_at_ms`,
      [tenantId, input.key, input.sendPolicy, nowMs],
    );

    const row = await this.get({ tenant_id: tenantId, key: input.key });
    if (!row) {
      throw new Error("session send policy override upsert failed");
    }
    return row;
  }

  async clear(input: { tenant_id?: string; key: string }): Promise<boolean> {
    const tenantId = input.tenant_id?.trim() || DEFAULT_TENANT_ID;
    const res = await this.db.run(
      "DELETE FROM session_send_policy_overrides WHERE tenant_id = ? AND key = ?",
      [tenantId, input.key],
    );
    return res.changes === 1;
  }
}
