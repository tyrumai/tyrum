import { randomUUID } from "node:crypto";
import type { MemoryItem } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { RawMemoryItemRow } from "./memory-dal-types.js";
import type { MemoryCreateInput, MemoryItemPatch } from "./types.js";
import { assertPatchCompatible, uniqSortedStrings } from "./memory-dal-helpers.js";
export { searchMemoryItems } from "./memory-dal-search.js";
export { consolidateMemoryToBudgets } from "./memory-dal-consolidation.js";

type Scope = { tenantId: string; agentId: string };

type DalGetById = {
  getById(memoryItemId: string, scope: Scope): Promise<MemoryItem | undefined>;
};

export async function createMemoryItem(
  db: SqlDb,
  input: MemoryCreateInput,
  scope: Scope,
  dal: DalGetById,
): Promise<MemoryItem> {
  const nowIso = new Date().toISOString();
  const memoryItemId = randomUUID();

  const tags = uniqSortedStrings(input.tags ?? []);
  const sensitivity = input.sensitivity ?? "private";

  const baseParams = {
    memory_item_id: memoryItemId,
    tenant_id: scope.tenantId,
    agent_id: scope.agentId,
    kind: input.kind,
    sensitivity,
    created_at: nowIso,
  } as const;

  await db.transaction(async (tx) => {
    switch (input.kind) {
      case "fact": {
        await tx.run(
          `INSERT INTO memory_items (
               tenant_id, agent_id, memory_item_id, kind, sensitivity,
               key, value_json, observed_at, confidence,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            baseParams.tenant_id,
            baseParams.agent_id,
            baseParams.memory_item_id,
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
               tenant_id, agent_id, memory_item_id, kind, sensitivity,
               title, body_md,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            baseParams.tenant_id,
            baseParams.agent_id,
            baseParams.memory_item_id,
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
               tenant_id, agent_id, memory_item_id, kind, sensitivity,
               title, body_md, confidence,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            baseParams.tenant_id,
            baseParams.agent_id,
            baseParams.memory_item_id,
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
               tenant_id, agent_id, memory_item_id, kind, sensitivity,
               occurred_at, summary_md,
               created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            baseParams.tenant_id,
            baseParams.agent_id,
            baseParams.memory_item_id,
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
           tenant_id,
           agent_id,
           memory_item_id,
           source_kind,
           channel,
           thread_id,
           session_id,
           message_id,
           tool_call_id,
           refs_json,
           metadata_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        baseParams.tenant_id,
        baseParams.agent_id,
        memoryItemId,
        input.provenance.source_kind,
        input.provenance.channel ?? null,
        input.provenance.thread_id ?? null,
        input.provenance.session_id ?? null,
        input.provenance.message_id ?? null,
        input.provenance.tool_call_id ?? null,
        JSON.stringify(input.provenance.refs ?? []),
        input.provenance.metadata !== undefined ? JSON.stringify(input.provenance.metadata) : null,
      ],
    );

    for (const tag of tags) {
      await tx.run(
        `INSERT INTO memory_item_tags (tenant_id, agent_id, memory_item_id, tag)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(tenant_id, agent_id, memory_item_id, tag) DO NOTHING`,
        [baseParams.tenant_id, baseParams.agent_id, memoryItemId, tag],
      );
    }
  });

  const created = await dal.getById(memoryItemId, scope);
  if (!created) throw new Error("failed to read created memory item");
  return created;
}

export async function updateMemoryItem(
  db: SqlDb,
  memoryItemId: string,
  patch: MemoryItemPatch,
  scope: Scope,
  dal: DalGetById,
): Promise<MemoryItem> {
  const nowIso = new Date().toISOString();

  await db.transaction(async (tx) => {
    const existing = await tx.get<Pick<RawMemoryItemRow, "kind">>(
      `SELECT kind
         FROM memory_items
         WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?`,
      [scope.tenantId, scope.agentId, memoryItemId],
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

    params.push(scope.tenantId, scope.agentId, memoryItemId);
    await tx.run(
      `UPDATE memory_items
         SET ${updates.join(", ")}
         WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?`,
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
           WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?`,
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
          scope.tenantId,
          scope.agentId,
          memoryItemId,
        ],
      );
    }

    if (patch.tags !== undefined) {
      const tags = uniqSortedStrings(patch.tags);
      await tx.run(
        `DELETE FROM memory_item_tags
           WHERE tenant_id = ? AND agent_id = ? AND memory_item_id = ?`,
        [scope.tenantId, scope.agentId, memoryItemId],
      );
      for (const tag of tags) {
        await tx.run(
          `INSERT INTO memory_item_tags (tenant_id, agent_id, memory_item_id, tag)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(tenant_id, agent_id, memory_item_id, tag) DO NOTHING`,
          [scope.tenantId, scope.agentId, memoryItemId, tag],
        );
      }
    }
  });

  const updated = await dal.getById(memoryItemId, scope);
  if (!updated) throw new Error("failed to read updated memory item");
  return updated;
}
