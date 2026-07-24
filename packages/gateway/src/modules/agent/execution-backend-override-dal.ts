import {
  ExecutionBackendId,
  type ExecutionBackendId as ExecutionBackendIdT,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

export interface ConversationExecutionBackendOverrideRow {
  tenant_id: string;
  conversation_id: string;
  backend_id: ExecutionBackendIdT;
  created_at: string;
  updated_at: string;
}

interface RawConversationExecutionBackendOverrideRow {
  tenant_id: string;
  conversation_id: string;
  backend_id: string;
  created_at: string | Date;
  updated_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(
  raw: RawConversationExecutionBackendOverrideRow,
): ConversationExecutionBackendOverrideRow {
  return {
    tenant_id: raw.tenant_id,
    conversation_id: raw.conversation_id,
    backend_id: ExecutionBackendId.parse(raw.backend_id),
    created_at: normalizeTime(raw.created_at),
    updated_at: normalizeTime(raw.updated_at),
  };
}

export class ConversationExecutionBackendOverrideDal {
  constructor(private readonly db: SqlDb) {}

  async get(input: {
    tenantId: string;
    conversationId: string;
  }): Promise<ConversationExecutionBackendOverrideRow | undefined> {
    const row = await this.db.get<RawConversationExecutionBackendOverrideRow>(
      `SELECT tenant_id,
              conversation_id,
              backend_id,
              created_at,
              updated_at
       FROM conversation_execution_backend_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [input.tenantId, input.conversationId],
    );
    return row ? toRow(row) : undefined;
  }

  async set(input: {
    tenantId: string;
    conversationId: string;
    backendId: ExecutionBackendIdT;
  }): Promise<ConversationExecutionBackendOverrideRow> {
    const nowIso = new Date().toISOString();
    await this.db.run(
      `INSERT INTO conversation_execution_backend_overrides (
         tenant_id,
         conversation_id,
         backend_id,
         created_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, conversation_id) DO UPDATE SET
         backend_id = excluded.backend_id,
         updated_at = excluded.updated_at`,
      [input.tenantId, input.conversationId, input.backendId, nowIso, nowIso],
    );

    const row = await this.get({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    });
    if (!row) {
      throw new Error("conversation execution backend override set failed");
    }
    return row;
  }

  async clear(input: { tenantId: string; conversationId: string }): Promise<boolean> {
    const result = await this.db.run(
      `DELETE FROM conversation_execution_backend_overrides
       WHERE tenant_id = ? AND conversation_id = ?`,
      [input.tenantId, input.conversationId],
    );
    return result.changes === 1;
  }
}
