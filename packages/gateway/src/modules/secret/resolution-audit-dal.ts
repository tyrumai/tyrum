import { randomUUID } from "node:crypto";
import type { SecretProviderKind, WsEventEnvelope } from "@tyrum/contracts";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import { enqueueWsBroadcastMessage } from "../../ws/outbox.js";

export type SecretResolutionOutcome = "resolved" | "failed";

export interface SecretResolutionRow {
  tenant_id: string;
  secret_resolution_id: string;
  tool_call_id: string;
  tool_id: string;
  handle_id: string;
  provider: SecretProviderKind;
  scope: string;
  agent_id: string | null;
  workspace_id: string | null;
  conversation_id: string | null;
  channel: string | null;
  thread_id: string | null;
  policy_snapshot_id: string | null;
  outcome: SecretResolutionOutcome;
  error: string | null;
  occurred_at: string;
}

interface RawSecretResolutionRow {
  tenant_id: string;
  secret_resolution_id: string;
  tool_call_id: string;
  tool_id: string;
  handle_id: string;
  provider: string;
  scope: string;
  agent_id: string | null;
  workspace_id: string | null;
  conversation_id: string | null;
  channel: string | null;
  thread_id: string | null;
  policy_snapshot_id: string | null;
  outcome: string;
  error: string | null;
  occurred_at: string | Date;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toRow(raw: RawSecretResolutionRow): SecretResolutionRow {
  return {
    tenant_id: raw.tenant_id,
    secret_resolution_id: raw.secret_resolution_id,
    tool_call_id: raw.tool_call_id,
    tool_id: raw.tool_id,
    handle_id: raw.handle_id,
    provider: raw.provider as SecretProviderKind,
    scope: raw.scope,
    agent_id: raw.agent_id,
    workspace_id: raw.workspace_id,
    conversation_id: raw.conversation_id,
    channel: raw.channel,
    thread_id: raw.thread_id,
    policy_snapshot_id: raw.policy_snapshot_id,
    outcome: raw.outcome as SecretResolutionOutcome,
    error: raw.error,
    occurred_at: normalizeTime(raw.occurred_at),
  };
}

export class SecretResolutionAuditDal {
  constructor(
    private readonly db: SqlDb,
    private readonly logger?: Logger,
  ) {}

  async record(params: {
    tenantId: string;
    toolCallId: string;
    toolId: string;
    handleId: string;
    provider: SecretProviderKind;
    scope: string;
    agentId?: string;
    workspaceId?: string;
    conversationId?: string;
    channel?: string;
    threadId?: string;
    policySnapshotId?: string;
    outcome: SecretResolutionOutcome;
    error?: string;
    occurredAtIso?: string;
  }): Promise<SecretResolutionRow> {
    const id = randomUUID();
    const occurredAt = params.occurredAtIso ?? new Date().toISOString();

    const inserted = await this.db.get<RawSecretResolutionRow>(
      `INSERT INTO secret_resolutions (
         tenant_id,
         secret_resolution_id,
         tool_call_id,
         tool_id,
         handle_id,
         provider,
         scope,
         agent_id,
         workspace_id,
         conversation_id,
         channel,
         thread_id,
         policy_snapshot_id,
         outcome,
         error,
         occurred_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, tool_call_id, handle_id) DO NOTHING
       RETURNING *`,
      [
        params.tenantId,
        id,
        params.toolCallId,
        params.toolId,
        params.handleId,
        params.provider,
        params.scope,
        params.agentId ?? null,
        params.workspaceId ?? null,
        params.conversationId ?? null,
        params.channel ?? null,
        params.threadId ?? null,
        params.policySnapshotId ?? null,
        params.outcome,
        params.error ?? null,
        occurredAt,
      ],
    );
    if (inserted) {
      const row = toRow(inserted);
      try {
        const evt: WsEventEnvelope = {
          event_id: randomUUID(),
          type: "secret.resolution",
          occurred_at: row.occurred_at,
          payload: {
            requester: {
              agent_id: row.agent_id,
              workspace_id: row.workspace_id,
              conversation_id: row.conversation_id,
              channel: row.channel,
              thread_id: row.thread_id,
            },
            resolution: {
              tenant_id: row.tenant_id,
              secret_resolution_id: row.secret_resolution_id,
              tool_call_id: row.tool_call_id,
              tool_id: row.tool_id,
              handle_id: row.handle_id,
              provider: row.provider,
              scope: row.scope,
              policy_snapshot_id: row.policy_snapshot_id,
              outcome: row.outcome,
              error: row.error,
              occurred_at: row.occurred_at,
            },
          },
        };
        await enqueueWsBroadcastMessage(this.db, row.tenant_id, evt);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.warn("secret.resolution_emit_failed", {
          tool_call_id: row.tool_call_id,
          handle_id: row.handle_id,
          error: message,
        });
      }
      return row;
    }

    const existing = await this.db.get<RawSecretResolutionRow>(
      `SELECT *
       FROM secret_resolutions
       WHERE tenant_id = ?
         AND tool_call_id = ?
         AND handle_id = ?
       ORDER BY occurred_at DESC
       LIMIT 1`,
      [params.tenantId, params.toolCallId, params.handleId],
    );
    if (!existing) {
      throw new Error("secret resolution audit insert failed");
    }
    return toRow(existing);
  }
}
