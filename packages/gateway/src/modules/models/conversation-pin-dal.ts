import type { SqlDb } from "../../statestore/types.js";

export interface ConversationProviderPinRow {
  tenant_id: string;
  conversation_id: string;
  provider_key: string;
  auth_profile_id: string;
  auth_profile_key: string;
  pinned_at: string;
}

interface RawConversationProviderPinRow {
  tenant_id: string;
  conversation_id: string;
  provider_key: string;
  auth_profile_id: string;
  auth_profile_key: string;
  pinned_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawConversationProviderPinRow): ConversationProviderPinRow {
  return {
    tenant_id: raw.tenant_id,
    conversation_id: raw.conversation_id,
    provider_key: raw.provider_key,
    auth_profile_id: raw.auth_profile_id,
    auth_profile_key: raw.auth_profile_key,
    pinned_at: normalizeTime(raw.pinned_at),
  };
}

export class ConversationProviderPinDal {
  constructor(private readonly db: SqlDb) {}

  async get(input: {
    tenantId: string;
    conversationId: string;
    providerKey: string;
  }): Promise<ConversationProviderPinRow | undefined> {
    const row = await this.db.get<RawConversationProviderPinRow>(
      `SELECT spp.tenant_id,
              spp.conversation_id AS conversation_id,
              spp.provider_key,
              spp.auth_profile_id,
              ap.auth_profile_key,
              spp.pinned_at
       FROM conversation_provider_pins spp
       JOIN auth_profiles ap
         ON ap.tenant_id = spp.tenant_id
        AND ap.auth_profile_id = spp.auth_profile_id
       WHERE spp.tenant_id = ?
         AND spp.conversation_id = ?
         AND spp.provider_key = ?
       LIMIT 1`,
      [input.tenantId, input.conversationId, input.providerKey],
    );
    return row ? toRow(row) : undefined;
  }

  async list(input: {
    tenantId: string;
    conversationId?: string;
    providerKey?: string;
    limit?: number;
  }): Promise<ConversationProviderPinRow[]> {
    const where: string[] = ["spp.tenant_id = ?"];
    const values: unknown[] = [input.tenantId];

    if (input.conversationId) {
      where.push("spp.conversation_id = ?");
      values.push(input.conversationId);
    }
    if (input.providerKey) {
      where.push("spp.provider_key = ?");
      values.push(input.providerKey);
    }

    const limit = Math.max(1, Math.min(500, input.limit ?? 200));
    const sql = `SELECT spp.tenant_id,
              spp.conversation_id AS conversation_id,
              spp.provider_key,
              spp.auth_profile_id,
              ap.auth_profile_key,
              spp.pinned_at
       FROM conversation_provider_pins spp
       JOIN auth_profiles ap
         ON ap.tenant_id = spp.tenant_id
        AND ap.auth_profile_id = spp.auth_profile_id
       WHERE ${where.join(" AND ")}
       ORDER BY spp.pinned_at DESC
       LIMIT ${String(limit)}`;

    const rows = await this.db.all<RawConversationProviderPinRow>(sql, values);
    return rows.map(toRow);
  }

  async upsert(input: {
    tenantId: string;
    conversationId: string;
    providerKey: string;
    authProfileId: string;
  }): Promise<ConversationProviderPinRow> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO conversation_provider_pins (
         tenant_id,
         conversation_id,
         provider_key,
         auth_profile_id,
         pinned_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_id, provider_key) DO UPDATE SET
         auth_profile_id = excluded.auth_profile_id,
         pinned_at = excluded.pinned_at`,
      [input.tenantId, input.conversationId, input.providerKey, input.authProfileId, nowIso],
    );

    const row = await this.get({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      providerKey: input.providerKey,
    });
    if (!row) {
      throw new Error("conversation provider pin upsert failed");
    }
    return row;
  }

  async clear(input: {
    tenantId: string;
    conversationId: string;
    providerKey: string;
  }): Promise<boolean> {
    const res = await this.db.run(
      `DELETE FROM conversation_provider_pins
       WHERE tenant_id = ? AND conversation_id = ? AND provider_key = ?`,
      [input.tenantId, input.conversationId, input.providerKey],
    );
    return res.changes === 1;
  }
}
