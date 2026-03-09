import type { SqlDb } from "../../statestore/types.js";

export type SessionLaneNodeAttachmentRow = {
  tenant_id: string;
  key: string;
  lane: string;
  source_client_device_id: string | null;
  attached_node_id: string | null;
  updated_at_ms: number;
};

export class SessionLaneNodeAttachmentDal {
  constructor(private readonly db: SqlDb) {}

  async upsert(input: {
    tenantId: string;
    key: string;
    lane: string;
    sourceClientDeviceId?: string | null;
    attachedNodeId?: string | null;
    updatedAtMs?: number;
  }): Promise<void> {
    const updatedAtMs = input.updatedAtMs ?? Date.now();
    await this.db.run(
      `INSERT INTO session_lane_node_attachments (
         tenant_id,
         key,
         lane,
         source_client_device_id,
         attached_node_id,
         updated_at_ms
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, key, lane) DO UPDATE SET
         source_client_device_id = excluded.source_client_device_id,
         attached_node_id = excluded.attached_node_id,
         updated_at_ms = excluded.updated_at_ms
       WHERE excluded.updated_at_ms >= session_lane_node_attachments.updated_at_ms`,
      [
        input.tenantId,
        input.key,
        input.lane,
        input.sourceClientDeviceId ?? null,
        input.attachedNodeId ?? null,
        updatedAtMs,
      ],
    );
  }

  async get(input: {
    tenantId: string;
    key: string;
    lane: string;
  }): Promise<SessionLaneNodeAttachmentRow | undefined> {
    return await this.db.get<SessionLaneNodeAttachmentRow>(
      `SELECT tenant_id, key, lane, source_client_device_id, attached_node_id, updated_at_ms
       FROM session_lane_node_attachments
       WHERE tenant_id = ? AND key = ? AND lane = ?`,
      [input.tenantId, input.key, input.lane],
    );
  }
}
