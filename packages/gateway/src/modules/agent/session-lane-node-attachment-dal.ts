import type { SqlDb } from "../../statestore/types.js";

export type SessionLaneNodeAttachmentRow = {
  tenant_id: string;
  key: string;
  lane: string;
  source_client_device_id: string | null;
  attached_node_id: string | null;
  desktop_environment_id: string | null;
  last_activity_at_ms: number | null;
  updated_at_ms: number;
};

const SELECT_ATTACHMENT_SQL = `SELECT tenant_id,
                                      key,
                                      lane,
                                      source_client_device_id,
                                      attached_node_id,
                                      desktop_environment_id,
                                      last_activity_at_ms,
                                      updated_at_ms
                               FROM session_lane_node_attachments
                               WHERE tenant_id = ? AND key = ? AND lane = ?`;

export class SessionLaneNodeAttachmentDal {
  constructor(private readonly db: SqlDb) {}

  private async readRow(input: {
    tenantId: string;
    key: string;
    lane: string;
  }): Promise<SessionLaneNodeAttachmentRow | undefined> {
    return await this.db.get<SessionLaneNodeAttachmentRow>(SELECT_ATTACHMENT_SQL, [
      input.tenantId,
      input.key,
      input.lane,
    ]);
  }

  private async hydrateManagedDesktopNode(
    row: SessionLaneNodeAttachmentRow,
  ): Promise<SessionLaneNodeAttachmentRow> {
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

    return (
      (await this.put({
        tenantId: row.tenant_id,
        key: row.key,
        lane: row.lane,
        attachedNodeId,
        updatedAtMs: Math.max(Date.now(), row.updated_at_ms),
      })) ?? { ...row, attached_node_id: attachedNodeId }
    );
  }

  async put(input: {
    tenantId: string;
    key: string;
    lane: string;
    sourceClientDeviceId?: string | null;
    attachedNodeId?: string | null;
    desktopEnvironmentId?: string | null;
    lastActivityAtMs?: number | null;
    updatedAtMs?: number;
    createIfMissing?: boolean;
  }): Promise<SessionLaneNodeAttachmentRow | undefined> {
    const updatedAtMs = input.updatedAtMs ?? Date.now();
    const sourceClientDevicePatched = input.sourceClientDeviceId !== undefined ? 1 : 0;
    const attachedNodePatched = input.attachedNodeId !== undefined ? 1 : 0;
    const desktopEnvironmentPatched = input.desktopEnvironmentId !== undefined ? 1 : 0;
    const lastActivityPatched = input.lastActivityAtMs !== undefined ? 1 : 0;
    const lastActivityAtMs =
      input.lastActivityAtMs !== undefined ? input.lastActivityAtMs : updatedAtMs;

    if (!input.createIfMissing) {
      await this.db.run(
        `UPDATE session_lane_node_attachments
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
         WHERE tenant_id = ? AND key = ? AND lane = ?
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
          input.lane,
          updatedAtMs,
        ],
      );
      const row = await this.readRow(input);
      return row ? await this.hydrateManagedDesktopNode(row) : undefined;
    }

    await this.db.run(
      `INSERT INTO session_lane_node_attachments (
         tenant_id,
         key,
         lane,
         source_client_device_id,
         attached_node_id,
         desktop_environment_id,
         last_activity_at_ms,
         updated_at_ms
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, key, lane) DO UPDATE SET
         source_client_device_id =
           CASE
             WHEN ? = 1 THEN excluded.source_client_device_id
             ELSE session_lane_node_attachments.source_client_device_id
           END,
         attached_node_id =
           CASE
             WHEN ? = 1 THEN excluded.attached_node_id
             ELSE session_lane_node_attachments.attached_node_id
           END,
         desktop_environment_id =
           CASE
             WHEN ? = 1 THEN excluded.desktop_environment_id
             ELSE session_lane_node_attachments.desktop_environment_id
           END,
         last_activity_at_ms =
           CASE
             WHEN ? = 1 THEN excluded.last_activity_at_ms
             ELSE session_lane_node_attachments.last_activity_at_ms
           END,
         updated_at_ms = excluded.updated_at_ms
       WHERE excluded.updated_at_ms >= session_lane_node_attachments.updated_at_ms`,
      [
        input.tenantId,
        input.key,
        input.lane,
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
    lane: string;
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
    lane: string;
  }): Promise<SessionLaneNodeAttachmentRow | undefined> {
    const row = await this.readRow(input);
    return row ? await this.hydrateManagedDesktopNode(row) : undefined;
  }

  async listIdleManagedDesktopAttachments(input: {
    idleBeforeMs: number;
    limit?: number;
  }): Promise<SessionLaneNodeAttachmentRow[]> {
    const rows = await this.db.all<SessionLaneNodeAttachmentRow>(
      `SELECT tenant_id,
              key,
              lane,
              source_client_device_id,
              attached_node_id,
              desktop_environment_id,
              last_activity_at_ms,
              updated_at_ms
       FROM session_lane_node_attachments
       WHERE desktop_environment_id IS NOT NULL
         AND COALESCE(last_activity_at_ms, updated_at_ms) <= ?
       ORDER BY COALESCE(last_activity_at_ms, updated_at_ms) ASC, updated_at_ms ASC
       LIMIT ?`,
      [input.idleBeforeMs, Math.max(1, Math.min(500, input.limit ?? 100))],
    );
    return await Promise.all(rows.map(async (row) => await this.hydrateManagedDesktopNode(row)));
  }

  async delete(input: { tenantId: string; key: string; lane: string }): Promise<void> {
    await this.db.run(
      `DELETE FROM session_lane_node_attachments
       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [input.tenantId, input.key, input.lane],
    );
  }
}
