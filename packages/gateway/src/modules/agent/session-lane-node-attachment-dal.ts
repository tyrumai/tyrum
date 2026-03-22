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
    const existing = await this.db.get<SessionLaneNodeAttachmentRow>(SELECT_ATTACHMENT_SQL, [
      input.tenantId,
      input.key,
      input.lane,
    ]);

    const hasExplicitPatch =
      input.sourceClientDeviceId !== undefined ||
      input.attachedNodeId !== undefined ||
      input.desktopEnvironmentId !== undefined ||
      input.lastActivityAtMs !== undefined;

    if (!existing && !input.createIfMissing && !hasExplicitPatch) {
      return undefined;
    }
    if (existing && updatedAtMs < existing.updated_at_ms) {
      return await this.hydrateManagedDesktopNode(existing);
    }

    const nextRow: SessionLaneNodeAttachmentRow = {
      tenant_id: input.tenantId,
      key: input.key,
      lane: input.lane,
      source_client_device_id:
        input.sourceClientDeviceId !== undefined
          ? input.sourceClientDeviceId
          : (existing?.source_client_device_id ?? null),
      attached_node_id:
        input.attachedNodeId !== undefined
          ? input.attachedNodeId
          : (existing?.attached_node_id ?? null),
      desktop_environment_id:
        input.desktopEnvironmentId !== undefined
          ? input.desktopEnvironmentId
          : (existing?.desktop_environment_id ?? null),
      last_activity_at_ms:
        input.lastActivityAtMs !== undefined
          ? input.lastActivityAtMs
          : (existing?.last_activity_at_ms ?? updatedAtMs),
      updated_at_ms: updatedAtMs,
    };

    if (!existing) {
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          nextRow.tenant_id,
          nextRow.key,
          nextRow.lane,
          nextRow.source_client_device_id,
          nextRow.attached_node_id,
          nextRow.desktop_environment_id,
          nextRow.last_activity_at_ms,
          nextRow.updated_at_ms,
        ],
      );
      return await this.hydrateManagedDesktopNode(nextRow);
    }

    await this.db.run(
      `UPDATE session_lane_node_attachments
       SET source_client_device_id = ?,
           attached_node_id = ?,
           desktop_environment_id = ?,
           last_activity_at_ms = ?,
           updated_at_ms = ?
       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [
        nextRow.source_client_device_id,
        nextRow.attached_node_id,
        nextRow.desktop_environment_id,
        nextRow.last_activity_at_ms,
        nextRow.updated_at_ms,
        nextRow.tenant_id,
        nextRow.key,
        nextRow.lane,
      ],
    );
    return await this.hydrateManagedDesktopNode(nextRow);
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
    const row = await this.db.get<SessionLaneNodeAttachmentRow>(SELECT_ATTACHMENT_SQL, [
      input.tenantId,
      input.key,
      input.lane,
    ]);
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
