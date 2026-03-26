import { randomUUID } from "node:crypto";
import type { NormalizedContainerKind } from "@tyrum/contracts";
import { normalizeDbDateTime } from "../../utils/db-time.js";
import type { SqlDb } from "../../statestore/types.js";

type RawObservedChannelThreadRow = {
  account_key: string;
  provider_thread_id: string;
  container_kind: NormalizedContainerKind;
  created_at: string | Date;
  session_title: string | null;
  last_active_at: string | Date | null;
};

export type ObservedChannelThread = {
  channel: string;
  accountKey: string;
  threadId: string;
  containerKind: NormalizedContainerKind;
  sessionTitle?: string;
  lastActiveAt?: string;
};

export class ChannelThreadDal {
  constructor(private readonly db: SqlDb) {}

  async ensureChannelAccountId(input: {
    tenantId: string;
    workspaceId: string;
    connectorKey: string;
    accountKey: string;
  }): Promise<string> {
    const inserted = await this.db.get<{ channel_account_id: string }>(
      `INSERT INTO channel_accounts (
         tenant_id,
         workspace_id,
         channel_account_id,
         connector_key,
         account_key,
         status
       )
       VALUES (?, ?, ?, ?, ?, 'active')
       ON CONFLICT (tenant_id, workspace_id, connector_key, account_key) DO NOTHING
       RETURNING channel_account_id`,
      [input.tenantId, input.workspaceId, randomUUID(), input.connectorKey, input.accountKey],
    );
    if (inserted?.channel_account_id) return inserted.channel_account_id;

    const existing = await this.db.get<{ channel_account_id: string }>(
      `SELECT channel_account_id
       FROM channel_accounts
       WHERE tenant_id = ?
         AND workspace_id = ?
         AND connector_key = ?
         AND account_key = ?
       LIMIT 1`,
      [input.tenantId, input.workspaceId, input.connectorKey, input.accountKey],
    );
    if (!existing?.channel_account_id) {
      throw new Error("failed to ensure channel account");
    }
    return existing.channel_account_id;
  }

  async ensureChannelThreadId(input: {
    tenantId: string;
    workspaceId: string;
    channelAccountId: string;
    providerThreadId: string;
    containerKind: NormalizedContainerKind;
  }): Promise<string> {
    const inserted = await this.db.get<{ channel_thread_id: string }>(
      `INSERT INTO channel_threads (
         tenant_id,
         workspace_id,
         channel_thread_id,
         channel_account_id,
         provider_thread_id,
         container_kind
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, workspace_id, channel_account_id, provider_thread_id) DO NOTHING
       RETURNING channel_thread_id`,
      [
        input.tenantId,
        input.workspaceId,
        randomUUID(),
        input.channelAccountId,
        input.providerThreadId,
        input.containerKind,
      ],
    );
    if (inserted?.channel_thread_id) return inserted.channel_thread_id;

    const existing = await this.db.get<{ channel_thread_id: string }>(
      `SELECT channel_thread_id
       FROM channel_threads
       WHERE tenant_id = ?
         AND workspace_id = ?
         AND channel_account_id = ?
         AND provider_thread_id = ?
       LIMIT 1`,
      [input.tenantId, input.workspaceId, input.channelAccountId, input.providerThreadId],
    );
    if (!existing?.channel_thread_id) {
      throw new Error("failed to ensure channel thread");
    }
    return existing.channel_thread_id;
  }

  async setChannelAccountStatus(input: {
    tenantId: string;
    workspaceId: string;
    channelAccountId: string;
    status: string;
    updatedAtIso?: string;
  }): Promise<boolean> {
    const updatedAtIso = input.updatedAtIso ?? new Date().toISOString();
    const result = await this.db.run(
      `UPDATE channel_accounts
       SET status = ?,
           updated_at = ?
       WHERE tenant_id = ?
         AND workspace_id = ?
         AND channel_account_id = ?
         AND status <> ?`,
      [
        input.status,
        updatedAtIso,
        input.tenantId,
        input.workspaceId,
        input.channelAccountId,
        input.status,
      ],
    );
    return result.changes === 1;
  }

  async listObservedThreads(input: {
    tenantId: string;
    connectorKey: string;
    limit?: number;
  }): Promise<ObservedChannelThread[]> {
    const tenantId = input.tenantId.trim();
    if (!tenantId) {
      throw new Error("tenantId is required");
    }
    const connectorKey = input.connectorKey.trim();
    if (!connectorKey) {
      throw new Error("connectorKey is required");
    }
    const limit =
      typeof input.limit === "number" && Number.isFinite(input.limit)
        ? Math.max(1, Math.min(200, Math.trunc(input.limit)))
        : 200;

    const rows = await this.db.all<RawObservedChannelThreadRow>(
      `SELECT
         ca.account_key,
         ct.provider_thread_id,
         ct.container_kind,
         ct.created_at,
         (
           SELECT NULLIF(TRIM(s.title), '')
           FROM conversations s
           WHERE s.tenant_id = ct.tenant_id
             AND s.channel_thread_id = ct.channel_thread_id
           ORDER BY s.updated_at DESC, s.conversation_id DESC
           LIMIT 1
         ) AS session_title,
         (
           SELECT s.updated_at
           FROM conversations s
           WHERE s.tenant_id = ct.tenant_id
             AND s.channel_thread_id = ct.channel_thread_id
           ORDER BY s.updated_at DESC, s.conversation_id DESC
           LIMIT 1
         ) AS last_active_at
       FROM channel_threads ct
       JOIN channel_accounts ca
         ON ca.tenant_id = ct.tenant_id
        AND ca.workspace_id = ct.workspace_id
        AND ca.channel_account_id = ct.channel_account_id
       WHERE ct.tenant_id = ?
         AND ca.connector_key = ?
       ORDER BY COALESCE(last_active_at, ct.created_at) DESC, ct.provider_thread_id ASC
       LIMIT ?`,
      [tenantId, connectorKey, limit],
    );

    return rows.map((row) => {
      const thread: ObservedChannelThread = {
        channel: connectorKey,
        accountKey: row.account_key,
        threadId: row.provider_thread_id,
        containerKind: row.container_kind,
        lastActiveAt: normalizeDbDateTime(row.last_active_at ?? row.created_at),
      };
      if (row.session_title) {
        thread.sessionTitle = row.session_title;
      }
      return thread;
    });
  }
}
