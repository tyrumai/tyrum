import type { SqlDb } from "../../statestore/types.js";

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

  async get(input: { key: string }): Promise<SessionSendPolicyOverrideRow | undefined> {
    const row = await this.db.get<RawSessionSendPolicyOverrideRow>(
      `SELECT key, send_policy, updated_at_ms
       FROM session_send_policy_overrides
       WHERE key = ?`,
      [input.key],
    );
    if (!row) return undefined;
    const sendPolicy = row.send_policy === "on" ? "on" : row.send_policy === "off" ? "off" : undefined;
    if (!sendPolicy) return undefined;
    return {
      key: row.key,
      send_policy: sendPolicy,
      updated_at_ms: asNumber(row.updated_at_ms),
    };
  }

  async upsert(input: { key: string; sendPolicy: "on" | "off" }): Promise<SessionSendPolicyOverrideRow> {
    const nowMs = Date.now();
    await this.db.run(
      `INSERT INTO session_send_policy_overrides (key, send_policy, updated_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET
         send_policy = excluded.send_policy,
         updated_at_ms = excluded.updated_at_ms`,
      [input.key, input.sendPolicy, nowMs],
    );

    const row = await this.get({ key: input.key });
    if (!row) {
      throw new Error("session send policy override upsert failed");
    }
    return row;
  }

  async clear(input: { key: string }): Promise<boolean> {
    const res = await this.db.run(
      "DELETE FROM session_send_policy_overrides WHERE key = ?",
      [input.key],
    );
    return res.changes === 1;
  }
}

