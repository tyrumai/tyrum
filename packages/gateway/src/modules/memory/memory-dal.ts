import type {
  BuiltinMemoryServerSettings,
  MemoryDeletedBy,
  MemoryItem,
  MemoryProvenance,
  MemoryTombstone,
} from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import { DEFAULT_AGENT_ID, DEFAULT_TENANT_ID } from "../identity/scope.js";
import type {
  MemoryConsolidationResult,
  RawMemoryItemRow,
  RawProvenanceRow,
  RawTagRow,
  RawTombstoneRow,
} from "./memory-dal-types.js";
export type { MemoryConsolidationResult } from "./memory-dal-types.js";
import type {
  MemoryCreateInput,
  MemoryForgetSelector,
  MemoryItemFilter,
  MemoryItemPatch,
  MemorySearchInput,
  MemorySearchResult,
} from "./types.js";
import {
  buildMemoryItemQueryParts,
  decodeCursor,
  encodeCursor,
  normalizeTime,
  parseJson,
} from "./memory-dal-helpers.js";
export { buildMemoryItemQueryParts } from "./memory-dal-helpers.js";
import {
  consolidateMemoryToBudgets,
  createMemoryItem,
  searchMemoryItems,
  updateMemoryItem,
} from "./memory-dal-operations.js";

export class MemoryDal {
  constructor(private readonly db: SqlDb) {}

  private normalizeScope(scope?: { tenantId?: string; agentId?: string } | string): {
    tenantId: string;
    agentId: string;
  } {
    const normalized = typeof scope === "string" ? { tenantId: undefined, agentId: scope } : scope;
    const tenantId = normalized?.tenantId?.trim();
    const agentId = normalized?.agentId?.trim();
    return {
      tenantId: tenantId && tenantId.length > 0 ? tenantId : DEFAULT_TENANT_ID,
      agentId: agentId && agentId.length > 0 ? agentId : DEFAULT_AGENT_ID,
    };
  }

  private async resolveSelectorIds(
    selector: MemoryForgetSelector,
    scope: { tenantId: string; agentId: string },
  ): Promise<string[]> {
    if (selector.kind === "id") {
      return [selector.memory_item_id];
    }

    if (selector.kind === "key") {
      const where: string[] = ["tenant_id = ?", "agent_id = ?", "key = ?"];
      const values: unknown[] = [scope.tenantId, scope.agentId, selector.key];

      if (selector.item_kind) {
        where.push("kind = ?");
        values.push(selector.item_kind);
      }

      const rows = await this.db.all<{ memory_item_id: string }>(
        `SELECT memory_item_id
         FROM memory_items
         WHERE ${where.join(" AND ")}`,
        values,
      );
      return rows.map((r) => r.memory_item_id);
    }

    if (selector.kind === "tag") {
      const rows = await this.db.all<{ memory_item_id: string }>(
        `SELECT DISTINCT memory_item_id
         FROM memory_item_tags
         WHERE tenant_id = ? AND agent_id = ? AND tag = ?`,
        [scope.tenantId, scope.agentId, selector.tag],
      );
      return rows.map((r) => r.memory_item_id);
    }

    const provenance = selector.provenance;
    const where: string[] = ["tenant_id = ?", "agent_id = ?"];
    const values: unknown[] = [scope.tenantId, scope.agentId];

    if (provenance.source_kind !== undefined) {
      where.push("source_kind = ?");
      values.push(provenance.source_kind);
    }
    if (provenance.channel !== undefined) {
      where.push("channel = ?");
      values.push(provenance.channel);
    }
    if (provenance.thread_id !== undefined) {
      where.push("thread_id = ?");
      values.push(provenance.thread_id);
    }
    if (provenance.session_id !== undefined) {
      where.push("session_id = ?");
      values.push(provenance.session_id);
    }
    if (provenance.message_id !== undefined) {
      where.push("message_id = ?");
      values.push(provenance.message_id);
    }
    if (provenance.tool_call_id !== undefined) {
      where.push("tool_call_id = ?");
      values.push(provenance.tool_call_id);
    }

    const rows = await this.db.all<{ memory_item_id: string }>(
      `SELECT memory_item_id
       FROM memory_item_provenance
       WHERE ${where.join(" AND ")}`,
      values,
    );
    return rows.map((r) => r.memory_item_id);
  }

  async list(params: {
    tenantId?: string;
    agentId?: string;
    filter?: MemoryItemFilter;
    limit?: number;
    cursor?: string;
  }): Promise<{ items: MemoryItem[]; next_cursor?: string }> {
    const scope = this.normalizeScope(params);

    const { from, where, values, limit } = buildMemoryItemQueryParts({
      tenantId: scope.tenantId,
      agentId: scope.agentId,
      filter: params.filter,
      limit: params.limit,
      cursor: params.cursor,
    });

    const rows = await this.db.all<{ memory_item_id: string; created_at: string | Date }>(
      `SELECT i.memory_item_id AS memory_item_id, i.created_at AS created_at
       FROM ${from}
       WHERE ${where.join(" AND ")}
       ORDER BY i.created_at DESC, i.memory_item_id DESC
       LIMIT ?`,
      [...values, limit],
    );

    const items: MemoryItem[] = [];
    for (const row of rows) {
      const item = await this.getById(row.memory_item_id, scope);
      if (item) items.push(item);
    }

    const last = rows.at(-1);
    const next_cursor =
      rows.length === limit && last
        ? encodeCursor({ sort: normalizeTime(last.created_at), id: last.memory_item_id })
        : undefined;

    return { items, next_cursor };
  }

  async forget(params: {
    tenantId?: string;
    agentId?: string;
    selectors: MemoryForgetSelector[];
    deleted_by: MemoryDeletedBy;
    reason?: string;
  }): Promise<{ deleted_count: number; tombstones: MemoryTombstone[] }> {
    const scope = this.normalizeScope(params);

    const ids = new Set<string>();
    for (const selector of params.selectors) {
      const matched = await this.resolveSelectorIds(selector, scope);
      for (const id of matched) ids.add(id);
    }

    const tombstones: MemoryTombstone[] = [];
    for (const id of ids) {
      try {
        const tombstone = await this.delete(
          id,
          { deleted_by: params.deleted_by, reason: params.reason },
          scope,
        );
        tombstones.push(tombstone);
      } catch (err) {
        if (err instanceof Error && err.message === "memory item not found") {
          continue;
        }
        throw err;
      }
    }

    return { deleted_count: tombstones.length, tombstones };
  }

  async listTombstones(params: {
    tenantId?: string;
    agentId?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ tombstones: MemoryTombstone[]; next_cursor?: string }> {
    const scope = this.normalizeScope(params);

    const where: string[] = ["tenant_id = ?", "agent_id = ?"];
    const values: unknown[] = [scope.tenantId, scope.agentId];

    if (params.cursor) {
      const cursor = decodeCursor(params.cursor);
      where.push("(deleted_at < ? OR (deleted_at = ? AND memory_item_id < ?))");
      values.push(cursor.sort, cursor.sort, cursor.id);
    }

    const limit = Math.max(1, Math.min(500, params.limit ?? 50));

    const rows = await this.db.all<RawTombstoneRow>(
      `SELECT *
       FROM memory_tombstones
       WHERE ${where.join(" AND ")}
       ORDER BY deleted_at DESC, memory_item_id DESC
       LIMIT ?`,
      [...values, limit],
    );

    const tombstones: MemoryTombstone[] = rows.map((r) => ({
      v: 1,
      memory_item_id: r.memory_item_id,
      agent_id: r.agent_id,
      deleted_at: normalizeTime(r.deleted_at),
      deleted_by: r.deleted_by,
      ...(r.reason ? { reason: r.reason } : {}),
    }));

    const last = rows.at(-1);
    const next_cursor =
      rows.length === limit && last
        ? encodeCursor({ sort: normalizeTime(last.deleted_at), id: last.memory_item_id })
        : undefined;

    return { tombstones, next_cursor };
  }

  async create(
    input: MemoryCreateInput,
    scope?: { tenantId?: string; agentId?: string } | string,
  ): Promise<MemoryItem> {
    return createMemoryItem(this.db, input, this.normalizeScope(scope), this);
  }

  async getById(
    memoryItemId: string,
    scope?: { tenantId?: string; agentId?: string } | string,
  ): Promise<MemoryItem | undefined> {
    const normalizedScope = this.normalizeScope(scope);

    const item = await this.db.get<RawMemoryItemRow>(
      `SELECT *
       FROM memory_items
       WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?`,
      [normalizedScope.tenantId, normalizedScope.agentId, memoryItemId],
    );
    if (!item) return undefined;

    const provenanceRow = await this.db.get<RawProvenanceRow>(
      `SELECT *
       FROM memory_item_provenance
       WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?`,
      [normalizedScope.tenantId, normalizedScope.agentId, memoryItemId],
    );
    if (!provenanceRow) {
      throw new Error(`missing provenance row for memory_item_id=${memoryItemId}`);
    }

    const tagRows = await this.db.all<RawTagRow>(
      `SELECT tag
       FROM memory_item_tags
       WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?
       ORDER BY tag ASC`,
      [normalizedScope.tenantId, normalizedScope.agentId, memoryItemId],
    );

    const provenance: MemoryProvenance = {
      source_kind: provenanceRow.source_kind,
      ...(provenanceRow.channel ? { channel: provenanceRow.channel } : {}),
      ...(provenanceRow.thread_id ? { thread_id: provenanceRow.thread_id } : {}),
      ...(provenanceRow.session_id ? { conversation_id: provenanceRow.session_id } : {}),
      ...(provenanceRow.message_id ? { message_id: provenanceRow.message_id } : {}),
      ...(provenanceRow.tool_call_id ? { tool_call_id: provenanceRow.tool_call_id } : {}),
      refs: parseJson<string[]>(provenanceRow.refs_json),
      ...(provenanceRow.metadata_json
        ? { metadata: parseJson<unknown>(provenanceRow.metadata_json) }
        : {}),
    };

    const base = {
      v: 1 as const,
      memory_item_id: item.memory_item_id,
      agent_id: item.agent_id,
      kind: item.kind,
      tags: tagRows.map((r) => r.tag),
      sensitivity: item.sensitivity,
      provenance,
      created_at: normalizeTime(item.created_at),
      ...(item.updated_at ? { updated_at: normalizeTime(item.updated_at) } : {}),
    };

    switch (item.kind) {
      case "fact": {
        if (
          !item.key ||
          item.value_json === null ||
          !item.observed_at ||
          item.confidence === null
        ) {
          throw new Error(`invalid fact row for memory_item_id=${memoryItemId}`);
        }
        return {
          ...base,
          kind: "fact",
          key: item.key,
          value: parseJson<unknown>(item.value_json),
          observed_at: item.observed_at,
          confidence: item.confidence,
        };
      }
      case "note": {
        if (!item.body_md) throw new Error(`invalid note row for memory_item_id=${memoryItemId}`);
        return {
          ...base,
          kind: "note",
          ...(item.title ? { title: item.title } : {}),
          body_md: item.body_md,
        };
      }
      case "procedure": {
        if (!item.body_md) {
          throw new Error(`invalid procedure row for memory_item_id=${memoryItemId}`);
        }
        return {
          ...base,
          kind: "procedure",
          ...(item.title ? { title: item.title } : {}),
          body_md: item.body_md,
          ...(item.confidence !== null ? { confidence: item.confidence } : {}),
        };
      }
      case "episode": {
        if (!item.occurred_at || !item.summary_md) {
          throw new Error(`invalid episode row for memory_item_id=${memoryItemId}`);
        }
        return {
          ...base,
          kind: "episode",
          occurred_at: item.occurred_at,
          summary_md: item.summary_md,
        };
      }
    }
  }

  async update(
    memoryItemId: string,
    patch: MemoryItemPatch,
    scope?: { tenantId?: string; agentId?: string } | string,
  ): Promise<MemoryItem> {
    return updateMemoryItem(this.db, memoryItemId, patch, this.normalizeScope(scope), this);
  }

  async search(
    input: MemorySearchInput,
    scope?: { tenantId?: string; agentId?: string } | string,
  ): Promise<MemorySearchResult> {
    return searchMemoryItems(this.db, input, this.normalizeScope(scope));
  }

  async delete(
    memoryItemId: string,
    params: { deleted_by: MemoryDeletedBy; reason?: string },
    scope?: { tenantId?: string; agentId?: string } | string,
  ): Promise<MemoryTombstone> {
    const normalizedScope = this.normalizeScope(scope);
    const nowIso = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const existingTombstone = await tx.get<RawTombstoneRow>(
        `SELECT *
         FROM memory_tombstones
         WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?`,
        [normalizedScope.tenantId, normalizedScope.agentId, memoryItemId],
      );
      if (existingTombstone) {
        await tx.run(
          `DELETE FROM memory_items
           WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?`,
          [normalizedScope.tenantId, normalizedScope.agentId, memoryItemId],
        );
        return {
          v: 1,
          memory_item_id: existingTombstone.memory_item_id,
          agent_id: existingTombstone.agent_id,
          deleted_at: normalizeTime(existingTombstone.deleted_at),
          deleted_by: existingTombstone.deleted_by,
          ...(existingTombstone.reason ? { reason: existingTombstone.reason } : {}),
        };
      }

      const exists = await tx.get<{ memory_item_id: string }>(
        `SELECT memory_item_id
         FROM memory_items
         WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?`,
        [normalizedScope.tenantId, normalizedScope.agentId, memoryItemId],
      );
      if (!exists) throw new Error("memory item not found");

      await tx.run(
        `INSERT INTO memory_tombstones (
           tenant_id,
           agent_id,
           memory_item_id,
           deleted_at,
           deleted_by,
           reason
         )
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, agent_id, memory_item_id) DO NOTHING`,
        [
          normalizedScope.tenantId,
          normalizedScope.agentId,
          memoryItemId,
          nowIso,
          params.deleted_by,
          params.reason ?? null,
        ],
      );

      await tx.run(
        `DELETE FROM memory_items
         WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?`,
        [normalizedScope.tenantId, normalizedScope.agentId, memoryItemId],
      );

      const tombstone = await tx.get<RawTombstoneRow>(
        `SELECT *
         FROM memory_tombstones
         WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?`,
        [normalizedScope.tenantId, normalizedScope.agentId, memoryItemId],
      );
      if (!tombstone) throw new Error("failed to read created tombstone");

      return {
        v: 1,
        memory_item_id: tombstone.memory_item_id,
        agent_id: tombstone.agent_id,
        deleted_at: normalizeTime(tombstone.deleted_at),
        deleted_by: tombstone.deleted_by,
        ...(tombstone.reason ? { reason: tombstone.reason } : {}),
      };
    });
  }

  async getTombstoneById(
    memoryItemId: string,
    scope?: { tenantId?: string; agentId?: string } | string,
  ): Promise<MemoryTombstone | undefined> {
    const normalizedScope = this.normalizeScope(scope);
    const tombstone = await this.db.get<RawTombstoneRow>(
      `SELECT *
       FROM memory_tombstones
       WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?`,
      [normalizedScope.tenantId, normalizedScope.agentId, memoryItemId],
    );
    if (!tombstone) return undefined;

    return {
      v: 1,
      memory_item_id: tombstone.memory_item_id,
      agent_id: tombstone.agent_id,
      deleted_at: normalizeTime(tombstone.deleted_at),
      deleted_by: tombstone.deleted_by,
      ...(tombstone.reason ? { reason: tombstone.reason } : {}),
    };
  }

  async consolidateToBudgets(params: {
    tenantId?: string;
    agentId?: string;
    budgets: BuiltinMemoryServerSettings["budgets"];
  }): Promise<MemoryConsolidationResult> {
    return consolidateMemoryToBudgets(this.db, this.normalizeScope(params), params.budgets, this);
  }
}
