import { randomUUID } from "node:crypto";
import type {
  MemoryDeletedBy,
  MemoryItem,
  MemoryItemCreateInput,
  MemoryItemKind,
  MemoryItemPatch,
  MemoryProvenance,
  MemorySensitivity,
  MemoryTombstone,
} from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";

interface RawMemoryItemRow {
  memory_item_id: string;
  agent_id: string;
  kind: MemoryItemKind;
  sensitivity: MemorySensitivity;
  key: string | null;
  value_json: string | null;
  observed_at: string | null;
  title: string | null;
  body_md: string | null;
  occurred_at: string | null;
  summary_md: string | null;
  confidence: number | null;
  created_at: string | Date;
  updated_at: string | Date | null;
}

interface RawProvenanceRow {
  memory_item_id: string;
  agent_id: string;
  source_kind: MemoryProvenance["source_kind"];
  channel: string | null;
  thread_id: string | null;
  session_id: string | null;
  message_id: string | null;
  tool_call_id: string | null;
  refs_json: string;
  metadata_json: string | null;
}

interface RawTagRow {
  tag: string;
}

interface RawTombstoneRow {
  memory_item_id: string;
  agent_id: string;
  deleted_at: string | Date;
  deleted_by: MemoryDeletedBy;
  reason: string | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function uniqSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].sort();
}

function assertPatchCompatible(kind: MemoryItemKind, patch: MemoryItemPatch): void {
  const incompatible: string[] = [];

  const isSet = (value: unknown): boolean => value !== undefined;

  const allowedCommon: readonly (keyof MemoryItemPatch)[] = ["tags", "sensitivity", "provenance"];
  const allowedKindSpecific: readonly (keyof MemoryItemPatch)[] =
    kind === "fact"
      ? ["key", "value", "observed_at", "confidence"]
      : kind === "note"
        ? ["title", "body_md"]
        : kind === "procedure"
          ? ["title", "body_md", "confidence"]
          : ["occurred_at", "summary_md"];

  const allowed = new Set<keyof MemoryItemPatch>([...allowedCommon, ...allowedKindSpecific]);

  const allFields: readonly (keyof MemoryItemPatch)[] = [
    "tags",
    "sensitivity",
    "provenance",
    "key",
    "value",
    "title",
    "body_md",
    "summary_md",
    "confidence",
    "observed_at",
    "occurred_at",
  ];

  for (const field of allFields) {
    if (allowed.has(field)) continue;
    if (isSet(patch[field])) incompatible.push(String(field));
  }

  if (incompatible.length > 0) {
    throw new Error(`incompatible patch fields for kind=${kind}: ${incompatible.join(", ")}`);
  }
}

export class MemoryV1Dal {
  constructor(private readonly db: SqlDb) {}

  private normalizeAgentId(agentId?: string): string {
    const trimmed = agentId?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : "default";
  }

  async create(input: MemoryItemCreateInput, agentId?: string): Promise<MemoryItem> {
    const agent = this.normalizeAgentId(agentId);
    const nowIso = new Date().toISOString();
    const memoryItemId = randomUUID();

    const tags = uniqSortedStrings(input.tags ?? []);
    const sensitivity = input.sensitivity ?? "private";

    const baseParams = {
      memory_item_id: memoryItemId,
      agent_id: agent,
      kind: input.kind,
      sensitivity,
      created_at: nowIso,
    } as const;

    await this.db.transaction(async (tx) => {
      switch (input.kind) {
        case "fact": {
          await tx.run(
            `INSERT INTO memory_items (
               memory_item_id, agent_id, kind, sensitivity,
               key, value_json, observed_at, confidence,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [
              baseParams.memory_item_id,
              baseParams.agent_id,
              baseParams.kind,
              baseParams.sensitivity,
              input.key,
              JSON.stringify(input.value),
              input.observed_at,
              input.confidence,
              baseParams.created_at,
            ],
          );
          break;
        }
        case "note": {
          await tx.run(
            `INSERT INTO memory_items (
               memory_item_id, agent_id, kind, sensitivity,
               title, body_md,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
            [
              baseParams.memory_item_id,
              baseParams.agent_id,
              baseParams.kind,
              baseParams.sensitivity,
              input.title ?? null,
              input.body_md,
              baseParams.created_at,
            ],
          );
          break;
        }
        case "procedure": {
          await tx.run(
            `INSERT INTO memory_items (
               memory_item_id, agent_id, kind, sensitivity,
               title, body_md, confidence,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
            [
              baseParams.memory_item_id,
              baseParams.agent_id,
              baseParams.kind,
              baseParams.sensitivity,
              input.title ?? null,
              input.body_md,
              input.confidence ?? null,
              baseParams.created_at,
            ],
          );
          break;
        }
        case "episode": {
          await tx.run(
            `INSERT INTO memory_items (
               memory_item_id, agent_id, kind, sensitivity,
               occurred_at, summary_md,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
            [
              baseParams.memory_item_id,
              baseParams.agent_id,
              baseParams.kind,
              baseParams.sensitivity,
              input.occurred_at,
              input.summary_md,
              baseParams.created_at,
            ],
          );
          break;
        }
      }

      await tx.run(
        `INSERT INTO memory_item_provenance (
           memory_item_id,
           agent_id,
           source_kind,
           channel,
           thread_id,
           session_id,
           message_id,
           tool_call_id,
           refs_json,
           metadata_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          memoryItemId,
          agent,
          input.provenance.source_kind,
          input.provenance.channel ?? null,
          input.provenance.thread_id ?? null,
          input.provenance.session_id ?? null,
          input.provenance.message_id ?? null,
          input.provenance.tool_call_id ?? null,
          JSON.stringify(input.provenance.refs ?? []),
          input.provenance.metadata !== undefined
            ? JSON.stringify(input.provenance.metadata)
            : null,
        ],
      );

      for (const tag of tags) {
        await tx.run(
          `INSERT INTO memory_item_tags (agent_id, memory_item_id, tag)
           VALUES (?, ?, ?)
           ON CONFLICT(agent_id, memory_item_id, tag) DO NOTHING`,
          [agent, memoryItemId, tag],
        );
      }
    });

    const created = await this.getById(memoryItemId, agent);
    if (!created) throw new Error("failed to read created memory item");
    return created;
  }

  async getById(memoryItemId: string, agentId?: string): Promise<MemoryItem | undefined> {
    const agent = this.normalizeAgentId(agentId);

    const item = await this.db.get<RawMemoryItemRow>(
      `SELECT *
       FROM memory_items
       WHERE agent_id = ? AND memory_item_id = ?`,
      [agent, memoryItemId],
    );
    if (!item) return undefined;

    const provenanceRow = await this.db.get<RawProvenanceRow>(
      `SELECT *
       FROM memory_item_provenance
       WHERE agent_id = ? AND memory_item_id = ?`,
      [agent, memoryItemId],
    );
    if (!provenanceRow) {
      throw new Error(`missing provenance row for memory_item_id=${memoryItemId}`);
    }

    const tagRows = await this.db.all<RawTagRow>(
      `SELECT tag
       FROM memory_item_tags
       WHERE agent_id = ? AND memory_item_id = ?
       ORDER BY tag ASC`,
      [agent, memoryItemId],
    );

    const provenance: MemoryProvenance = {
      source_kind: provenanceRow.source_kind,
      ...(provenanceRow.channel ? { channel: provenanceRow.channel } : {}),
      ...(provenanceRow.thread_id ? { thread_id: provenanceRow.thread_id } : {}),
      ...(provenanceRow.session_id ? { session_id: provenanceRow.session_id } : {}),
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
    agentId?: string,
  ): Promise<MemoryItem> {
    const agent = this.normalizeAgentId(agentId);
    const nowIso = new Date().toISOString();

    await this.db.transaction(async (tx) => {
      const existing = await tx.get<Pick<RawMemoryItemRow, "kind">>(
        `SELECT kind
         FROM memory_items
         WHERE agent_id = ? AND memory_item_id = ?`,
        [agent, memoryItemId],
      );
      if (!existing) throw new Error("memory item not found");

      assertPatchCompatible(existing.kind, patch);

      const updates: string[] = ["updated_at = ?"];
      const params: unknown[] = [nowIso];

      if (patch.sensitivity !== undefined) {
        updates.push("sensitivity = ?");
        params.push(patch.sensitivity);
      }

      switch (existing.kind) {
        case "fact": {
          if (patch.key !== undefined) {
            updates.push("key = ?");
            params.push(patch.key);
          }
          if (patch.value !== undefined) {
            updates.push("value_json = ?");
            params.push(JSON.stringify(patch.value));
          }
          if (patch.observed_at !== undefined) {
            updates.push("observed_at = ?");
            params.push(patch.observed_at);
          }
          if (patch.confidence !== undefined) {
            updates.push("confidence = ?");
            params.push(patch.confidence);
          }
          break;
        }
        case "note": {
          if (patch.title !== undefined) {
            updates.push("title = ?");
            params.push(patch.title);
          }
          if (patch.body_md !== undefined) {
            updates.push("body_md = ?");
            params.push(patch.body_md);
          }
          break;
        }
        case "procedure": {
          if (patch.title !== undefined) {
            updates.push("title = ?");
            params.push(patch.title);
          }
          if (patch.body_md !== undefined) {
            updates.push("body_md = ?");
            params.push(patch.body_md);
          }
          if (patch.confidence !== undefined) {
            updates.push("confidence = ?");
            params.push(patch.confidence);
          }
          break;
        }
        case "episode": {
          if (patch.occurred_at !== undefined) {
            updates.push("occurred_at = ?");
            params.push(patch.occurred_at);
          }
          if (patch.summary_md !== undefined) {
            updates.push("summary_md = ?");
            params.push(patch.summary_md);
          }
          break;
        }
      }

      params.push(agent, memoryItemId);
      await tx.run(
        `UPDATE memory_items
         SET ${updates.join(", ")}
         WHERE agent_id = ? AND memory_item_id = ?`,
        params,
      );

      if (patch.provenance !== undefined) {
        await tx.run(
          `UPDATE memory_item_provenance
           SET source_kind = ?,
               channel = ?,
               thread_id = ?,
               session_id = ?,
               message_id = ?,
               tool_call_id = ?,
               refs_json = ?,
               metadata_json = ?
           WHERE agent_id = ? AND memory_item_id = ?`,
          [
            patch.provenance.source_kind,
            patch.provenance.channel ?? null,
            patch.provenance.thread_id ?? null,
            patch.provenance.session_id ?? null,
            patch.provenance.message_id ?? null,
            patch.provenance.tool_call_id ?? null,
            JSON.stringify(patch.provenance.refs ?? []),
            patch.provenance.metadata !== undefined
              ? JSON.stringify(patch.provenance.metadata)
              : null,
            agent,
            memoryItemId,
          ],
        );
      }

      if (patch.tags !== undefined) {
        const tags = uniqSortedStrings(patch.tags);
        await tx.run(
          `DELETE FROM memory_item_tags
           WHERE agent_id = ? AND memory_item_id = ?`,
          [agent, memoryItemId],
        );
        for (const tag of tags) {
          await tx.run(
            `INSERT INTO memory_item_tags (agent_id, memory_item_id, tag)
             VALUES (?, ?, ?)
             ON CONFLICT(agent_id, memory_item_id, tag) DO NOTHING`,
            [agent, memoryItemId, tag],
          );
        }
      }
    });

    const updated = await this.getById(memoryItemId, agent);
    if (!updated) throw new Error("failed to read updated memory item");
    return updated;
  }

  async delete(
    memoryItemId: string,
    params: { deleted_by: MemoryDeletedBy; reason?: string },
    agentId?: string,
  ): Promise<MemoryTombstone> {
    const agent = this.normalizeAgentId(agentId);
    const nowIso = new Date().toISOString();

    return await this.db.transaction(async (tx) => {
      const existingTombstone = await tx.get<RawTombstoneRow>(
        `SELECT *
         FROM memory_tombstones
         WHERE agent_id = ? AND memory_item_id = ?`,
        [agent, memoryItemId],
      );
      if (existingTombstone) {
        await tx.run(
          `DELETE FROM memory_items
           WHERE agent_id = ? AND memory_item_id = ?`,
          [agent, memoryItemId],
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
         WHERE agent_id = ? AND memory_item_id = ?`,
        [agent, memoryItemId],
      );
      if (!exists) throw new Error("memory item not found");

      await tx.run(
        `INSERT INTO memory_tombstones (memory_item_id, agent_id, deleted_at, deleted_by, reason)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(memory_item_id) DO NOTHING`,
        [memoryItemId, agent, nowIso, params.deleted_by, params.reason ?? null],
      );

      await tx.run(
        `DELETE FROM memory_items
         WHERE agent_id = ? AND memory_item_id = ?`,
        [agent, memoryItemId],
      );

      const tombstone = await tx.get<RawTombstoneRow>(
        `SELECT *
         FROM memory_tombstones
         WHERE agent_id = ? AND memory_item_id = ?`,
        [agent, memoryItemId],
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
    agentId?: string,
  ): Promise<MemoryTombstone | undefined> {
    const agent = this.normalizeAgentId(agentId);
    const tombstone = await this.db.get<RawTombstoneRow>(
      `SELECT *
       FROM memory_tombstones
       WHERE agent_id = ? AND memory_item_id = ?`,
      [agent, memoryItemId],
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
}
