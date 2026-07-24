import type { ExecutionBackendId } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

export interface HarnessSessionRow {
  tenant_id: string;
  conversation_id: string;
  backend_id: string;
  session_ref: string;
  created_at: string;
  updated_at: string;
}

interface RawHarnessSessionRow extends Omit<HarnessSessionRow, "created_at" | "updated_at"> {
  created_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawHarnessSessionRow): HarnessSessionRow {
  return {
    tenant_id: raw.tenant_id,
    conversation_id: raw.conversation_id,
    backend_id: raw.backend_id,
    session_ref: raw.session_ref,
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export interface HarnessSessionKey {
  tenantId: string;
  conversationId: string;
  backendId: ExecutionBackendId;
}

/**
 * Maps `(conversation, backend)` to the harness-side session reference.
 *
 * Per ARCH-22 this is a resume-fidelity cache, never the source of transcript
 * truth: a missing or stale row only costs a fresh harness session seeded from
 * Tyrum's conversation-state checkpoint.
 */
export class HarnessSessionDal {
  constructor(private readonly db: SqlDb) {}

  async get(key: HarnessSessionKey): Promise<HarnessSessionRow | undefined> {
    const row = await this.db.get<RawHarnessSessionRow>(
      `SELECT tenant_id, conversation_id, backend_id, session_ref, created_at, updated_at
         FROM harness_sessions
        WHERE tenant_id = ? AND conversation_id = ? AND backend_id = ?`,
      [key.tenantId, key.conversationId, key.backendId],
    );
    return row ? toRow(row) : undefined;
  }

  async set(input: HarnessSessionKey & { sessionRef: string }): Promise<HarnessSessionRow> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO harness_sessions (
         tenant_id, conversation_id, backend_id, session_ref, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_id, backend_id) DO UPDATE SET
         session_ref = excluded.session_ref,
         updated_at = excluded.updated_at`,
      [input.tenantId, input.conversationId, input.backendId, input.sessionRef, nowIso, nowIso],
    );

    const row = await this.get(input);
    if (!row) {
      throw new Error("harness session upsert failed");
    }
    return row;
  }

  async clear(key: HarnessSessionKey): Promise<boolean> {
    const result = await this.db.run(
      `DELETE FROM harness_sessions
        WHERE tenant_id = ? AND conversation_id = ? AND backend_id = ?`,
      [key.tenantId, key.conversationId, key.backendId],
    );
    return result.changes === 1;
  }
}
