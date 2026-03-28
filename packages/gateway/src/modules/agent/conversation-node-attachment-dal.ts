import type { SqlDb } from "../../statestore/types.js";

export type ConversationNodeAttachmentRow = {
  tenant_id: string;
  key: string;
  source_client_device_id: string | null;
  attached_node_id: string | null;
  desktop_environment_id: string | null;
  last_activity_at_ms: number | null;
  updated_at_ms: number;
};

const SELECT_ATTACHMENT_SQL = `SELECT tenant_id,
                                      key,
                                      source_client_device_id,
                                      attached_node_id,
                                      desktop_environment_id,
                                      last_activity_at_ms,
                                      updated_at_ms
                               FROM conversation_node_attachments
                               WHERE tenant_id = ? AND key = ?`;

export class ConversationNodeAttachmentDal {
  constructor(private readonly db: SqlDb) {}

  private async readRow(input: {
    tenantId: string;
    key: string;
  }): Promise<ConversationNodeAttachmentRow | undefined> {
    return await this.db.get<ConversationNodeAttachmentRow>(SELECT_ATTACHMENT_SQL, [
      input.tenantId,
      input.key,
    ]);
  }

  private async hydrateManagedDesktopNode(
    row: ConversationNodeAttachmentRow,
  ): Promise<ConversationNodeAttachmentRow> {
    if (row.desktop_environment_id === null || row.attached_node_id !== null) {
      return row;
    }

    const environment = await this.db.get<{ node_id: string | null }>(
      `SELECT node_id
       FROM desktop_environments
       WHERE tenant_id = ? AND environment_id = ?`,
      [row.tenant_id, row.desktop_environment_id],
    );
    const attachedNodeId = environment?.node_id?.trim() || null;
    if (attachedNodeId === null) {
      return row;
    }

    const hydratedUpdatedAtMs = Math.max(Date.now(), row.updated_at_ms);
    await this.db.run(
      `UPDATE conversation_node_attachments
       SET attached_node_id = ?,
           updated_at_ms = ?
       WHERE tenant_id = ? AND key = ?
         AND desktop_environment_id = ?
         AND attached_node_id IS NULL
         AND updated_at_ms <= ?`,
      [
        attachedNodeId,
        hydratedUpdatedAtMs,
        row.tenant_id,
        row.key,
        row.desktop_environment_id,
        hydratedUpdatedAtMs,
      ],
    );

    return (
      (await this.readRow({
        tenantId: row.tenant_id,
        key: row.key,
      })) ?? row
    );
  }

  async put(input: {
    tenantId: string;
    key: string;
    sourceClientDeviceId?: string | null;
    attachedNodeId?: string | null;
    desktopEnvironmentId?: string | null;
    lastActivityAtMs?: number | null;
    updatedAtMs?: number;
    createIfMissing?: boolean;
  }): Promise<ConversationNodeAttachmentRow | undefined> {
    const updatedAtMs = input.updatedAtMs ?? Date.now();
    const sourceClientDevicePatched = input.sourceClientDeviceId !== undefined ? 1 : 0;
    const attachedNodePatched = input.attachedNodeId !== undefined ? 1 : 0;
    const desktopEnvironmentPatched = input.desktopEnvironmentId !== undefined ? 1 : 0;
    const lastActivityPatched = input.lastActivityAtMs !== undefined ? 1 : 0;
    const lastActivityAtMs =
      input.lastActivityAtMs !== undefined ? input.lastActivityAtMs : updatedAtMs;

    if (!input.createIfMissing) {
      await this.db.run(
        `UPDATE conversation_node_attachments
         SET source_client_device_id =
               CASE
                 WHEN ? = 1 THEN ?
                 ELSE source_client_device_id
               END,
             attached_node_id =
               CASE
                 WHEN ? = 1 THEN ?
                 ELSE attached_node_id
               END,
             desktop_environment_id =
               CASE
                 WHEN ? = 1 THEN ?
                 ELSE desktop_environment_id
               END,
             last_activity_at_ms =
               CASE
                 WHEN ? = 1 THEN ?
                 ELSE last_activity_at_ms
               END,
             updated_at_ms = ?
         WHERE tenant_id = ? AND key = ?
           AND updated_at_ms <= ?`,
        [
          sourceClientDevicePatched,
          input.sourceClientDeviceId ?? null,
          attachedNodePatched,
          input.attachedNodeId ?? null,
          desktopEnvironmentPatched,
          input.desktopEnvironmentId ?? null,
          lastActivityPatched,
          lastActivityAtMs,
          updatedAtMs,
          input.tenantId,
          input.key,
          updatedAtMs,
        ],
      );
      const row = await this.readRow(input);
      return row ? await this.hydrateManagedDesktopNode(row) : undefined;
    }

    await this.db.run(
      `INSERT INTO conversation_node_attachments (
         tenant_id,
         key,
         source_client_device_id,
         attached_node_id,
         desktop_environment_id,
         last_activity_at_ms,
         updated_at_ms
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, key) DO UPDATE SET
         source_client_device_id =
           CASE
             WHEN ? = 1 THEN excluded.source_client_device_id
             ELSE conversation_node_attachments.source_client_device_id
           END,
         attached_node_id =
           CASE
             WHEN ? = 1 THEN excluded.attached_node_id
             ELSE conversation_node_attachments.attached_node_id
           END,
         desktop_environment_id =
           CASE
             WHEN ? = 1 THEN excluded.desktop_environment_id
             ELSE conversation_node_attachments.desktop_environment_id
           END,
         last_activity_at_ms =
           CASE
             WHEN ? = 1 THEN excluded.last_activity_at_ms
             ELSE conversation_node_attachments.last_activity_at_ms
           END,
         updated_at_ms = excluded.updated_at_ms
       WHERE excluded.updated_at_ms >= conversation_node_attachments.updated_at_ms`,
      [
        input.tenantId,
        input.key,
        input.sourceClientDeviceId ?? null,
        input.attachedNodeId ?? null,
        input.desktopEnvironmentId ?? null,
        lastActivityAtMs,
        updatedAtMs,
        sourceClientDevicePatched,
        attachedNodePatched,
        desktopEnvironmentPatched,
        lastActivityPatched,
      ],
    );
    const row = await this.readRow(input);
    return row ? await this.hydrateManagedDesktopNode(row) : undefined;
  }

  async upsert(input: {
    tenantId: string;
    key: string;
    sourceClientDeviceId?: string | null;
    attachedNodeId?: string | null;
    desktopEnvironmentId?: string | null;
    lastActivityAtMs?: number | null;
    updatedAtMs?: number;
  }): Promise<void> {
    await this.put({
      ...input,
      createIfMissing: true,
    });
  }

  async get(input: {
    tenantId: string;
    key: string;
  }): Promise<ConversationNodeAttachmentRow | undefined> {
    const row = await this.readRow(input);
    return row ? await this.hydrateManagedDesktopNode(row) : undefined;
  }

  async listIdleManagedDesktopAttachments(input: {
    idleBeforeMs: number;
    limit?: number;
  }): Promise<ConversationNodeAttachmentRow[]> {
    const rows = await this.db.all<ConversationNodeAttachmentRow>(
      `SELECT tenant_id,
              key,
              source_client_device_id,
              attached_node_id,
              desktop_environment_id,
              last_activity_at_ms,
              updated_at_ms
       FROM conversation_node_attachments
       WHERE desktop_environment_id IS NOT NULL
         AND COALESCE(last_activity_at_ms, updated_at_ms) <= ?
       ORDER BY COALESCE(last_activity_at_ms, updated_at_ms) ASC, updated_at_ms ASC
       LIMIT ?`,
      [input.idleBeforeMs, Math.max(1, Math.min(500, input.limit ?? 100))],
    );
    return await Promise.all(rows.map(async (row) => await this.hydrateManagedDesktopNode(row)));
  }

  async delete(input: { tenantId: string; key: string }): Promise<void> {
    await this.db.run(
      `DELETE FROM conversation_node_attachments
       WHERE tenant_id = ? AND key = ?`,
      [input.tenantId, input.key],
    );
  }
}
