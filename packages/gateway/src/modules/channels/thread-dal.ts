import { randomUUID } from "node:crypto";
import type { NormalizedContainerKind } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

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
}
