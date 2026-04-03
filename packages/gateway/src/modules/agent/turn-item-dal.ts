import { TurnItem } from "@tyrum/contracts";
import type { TurnItem as TurnItemRecord } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { buildSqlPlaceholders } from "../../utils/sql.js";

type RawTurnItemRow = {
  turn_item_id: string;
  turn_id: string;
  item_index: number;
  item_key: string;
  kind: string;
  payload_json: string;
  created_at: string | Date;
};

export type EnsureTurnItemInput = {
  tenantId: string;
  turnItemId: string;
  turnId: string;
  itemIndex: number;
  itemKey: string;
  kind: TurnItemRecord["kind"];
  payload: TurnItemRecord["payload"];
  createdAt: string;
};

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parsePayload(raw: string): unknown {
  return JSON.parse(raw) as unknown;
}

function toTurnItem(row: RawTurnItemRow): TurnItemRecord {
  return TurnItem.parse({
    turn_item_id: row.turn_item_id,
    turn_id: row.turn_id,
    item_index: row.item_index,
    item_key: row.item_key,
    kind: row.kind,
    payload: parsePayload(row.payload_json),
    created_at: normalizeTime(row.created_at),
  });
}

export class TurnItemDal {
  constructor(private readonly db: SqlDb) {}

  async shiftItemIndices(input: {
    tenantId: string;
    turnId: string;
    fromIndex?: number;
    delta: number;
  }): Promise<void> {
    if (input.delta === 0) {
      return;
    }

    const fromIndex = input.fromIndex ?? 0;
    if (input.delta < 0 && fromIndex + input.delta < 0) {
      throw new Error("shifted turn_items would produce a negative item_index");
    }

    const row = await this.db.get<{ max_index: number | null }>(
      `SELECT MAX(item_index) AS max_index
       FROM turn_items
       WHERE tenant_id = ? AND turn_id = ? AND item_index >= ?`,
      [input.tenantId, input.turnId, fromIndex],
    );
    const maxIndex = row?.max_index;
    if (maxIndex === null || maxIndex === undefined) {
      return;
    }

    // Move the affected slice out of the way first so the final shift
    // cannot transiently collide with the unique (turn_id, item_index) key.
    const temporaryOffset = maxIndex + Math.abs(input.delta) + 1;
    await this.db.run(
      `UPDATE turn_items
       SET item_index = item_index + ?
       WHERE tenant_id = ? AND turn_id = ? AND item_index >= ?`,
      [temporaryOffset, input.tenantId, input.turnId, fromIndex],
    );
    await this.db.run(
      `UPDATE turn_items
       SET item_index = item_index - ? + ?
       WHERE tenant_id = ? AND turn_id = ? AND item_index >= ?`,
      [temporaryOffset, input.delta, input.tenantId, input.turnId, fromIndex + temporaryOffset],
    );
  }

  async ensureItem(input: EnsureTurnItemInput): Promise<TurnItemRecord> {
    const inserted = await this.db.get<RawTurnItemRow>(
      `INSERT INTO turn_items (
         tenant_id,
         turn_item_id,
         turn_id,
         item_index,
         item_key,
         kind,
         payload_json,
         created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, turn_id, item_key) DO NOTHING
       RETURNING turn_item_id, turn_id, item_index, item_key, kind, payload_json, created_at`,
      [
        input.tenantId,
        input.turnItemId,
        input.turnId,
        input.itemIndex,
        input.itemKey,
        input.kind,
        JSON.stringify(input.payload),
        input.createdAt,
      ],
    );
    if (inserted) {
      return toTurnItem(inserted);
    }

    const existing = await this.db.get<RawTurnItemRow>(
      `SELECT turn_item_id, turn_id, item_index, item_key, kind, payload_json, created_at
       FROM turn_items
       WHERE tenant_id = ? AND turn_id = ? AND item_key = ?`,
      [input.tenantId, input.turnId, input.itemKey],
    );
    if (!existing) {
      throw new Error(`turn item '${input.itemKey}' was not persisted`);
    }
    return toTurnItem(existing);
  }

  async listByTurnId(input: { tenantId: string; turnId: string }): Promise<TurnItemRecord[]> {
    const itemsByTurn = await this.listByTurnIds({
      tenantId: input.tenantId,
      turnIds: [input.turnId],
    });
    return itemsByTurn.get(input.turnId) ?? [];
  }

  async listByTurnIds(input: {
    tenantId: string;
    turnIds: readonly string[];
  }): Promise<Map<string, TurnItemRecord[]>> {
    const itemsByTurn = new Map<string, TurnItemRecord[]>();
    if (input.turnIds.length === 0) {
      return itemsByTurn;
    }

    const rows = await this.db.all<RawTurnItemRow>(
      `SELECT turn_item_id, turn_id, item_index, item_key, kind, payload_json, created_at
       FROM turn_items
       WHERE tenant_id = ?
         AND turn_id IN (${buildSqlPlaceholders(input.turnIds.length)})
       ORDER BY turn_id ASC, item_index ASC`,
      [input.tenantId, ...input.turnIds],
    );

    for (const row of rows) {
      const turnItem = toTurnItem(row);
      const items = itemsByTurn.get(turnItem.turn_id) ?? [];
      items.push(turnItem);
      itemsByTurn.set(turnItem.turn_id, items);
    }

    return itemsByTurn;
  }
}
