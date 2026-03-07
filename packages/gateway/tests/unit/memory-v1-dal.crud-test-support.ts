import { expect, it } from "vitest";
import type { MemoryV1DalFixture } from "./memory-v1-dal.test-support.js";
import {
  OBSERVED_AT,
  ensureAgentScopes,
  factInput,
  noteInput,
  userProvenance,
  withOpenDal,
} from "./memory-v1-dal.test-support.js";

export function registerMemoryV1DalCrudTests(fixture: MemoryV1DalFixture): void {
  it("creates, reads, updates, and deletes with a tombstone", async () => {
    await withOpenDal(fixture, async ({ dal, db }) => {
      const { scopeA } = await ensureAgentScopes(db);

      const created = await dal.create(
        factInput({
          key: "favorite_color",
          value: "blue",
          observed_at: OBSERVED_AT,
          confidence: 0.9,
          tags: ["project", "prefs"],
          provenance: userProvenance({
            channel: "telegram",
            thread_id: "123",
            session_id: "agent:default:main",
            refs: ["msg:1"],
            metadata: { lang: "en" },
          }),
        }),
        scopeA,
      );

      expect(created.v).toBe(1);
      expect(created.kind).toBe("fact");
      expect(created.agent_id).toBe(scopeA.agentId);
      expect(created.tags.toSorted()).toEqual(["prefs", "project"]);
      expect(created.created_at).toBeTruthy();
      expect(created.updated_at).toBeUndefined();
      expect(created.provenance.source_kind).toBe("user");
      expect(created.provenance.channel).toBe("telegram");
      expect(created.provenance.refs).toEqual(["msg:1"]);
      expect(created.key).toBe("favorite_color");
      expect(created.value).toBe("blue");
      expect(created.observed_at).toBe(OBSERVED_AT);
      expect(created.confidence).toBe(0.9);

      const fetched = await dal.getById(created.memory_item_id, scopeA);
      expect(fetched).toEqual(created);

      const updated = await dal.update(
        created.memory_item_id,
        { value: "green", confidence: 0.5, tags: ["prefs"] },
        scopeA,
      );
      expect(updated.v).toBe(1);
      expect(updated.memory_item_id).toBe(created.memory_item_id);
      expect(updated.agent_id).toBe(scopeA.agentId);
      expect(updated.kind).toBe("fact");
      expect(updated.value).toBe("green");
      expect(updated.confidence).toBe(0.5);
      expect(updated.tags).toEqual(["prefs"]);
      expect(updated.updated_at).toBeTruthy();

      const tombstone = await dal.delete(
        created.memory_item_id,
        { deleted_by: "operator", reason: "user request" },
        scopeA,
      );
      expect(tombstone.v).toBe(1);
      expect(tombstone.agent_id).toBe(scopeA.agentId);
      expect(tombstone.memory_item_id).toBe(created.memory_item_id);
      expect(tombstone.deleted_at).toBeTruthy();
      expect(tombstone.deleted_by).toBe("operator");
      expect(tombstone.reason).toBe("user request");

      expect(await dal.getById(created.memory_item_id, scopeA)).toBeUndefined();
      expect(await dal.getTombstoneById(created.memory_item_id, scopeA)).toEqual(tombstone);
    });
  });

  it("partitions all records by agent_id", async () => {
    await withOpenDal(fixture, async ({ dal, db }) => {
      const { scopeA, scopeB } = await ensureAgentScopes(db);

      const created = await dal.create(
        noteInput({
          title: "On-call notes",
          body_md: "Remember to check dashboards.",
          tags: ["project"],
        }),
        scopeA,
      );

      expect(await dal.getById(created.memory_item_id, scopeB)).toBeUndefined();

      await dal.delete(created.memory_item_id, { deleted_by: "operator" }, scopeA);
      expect(await dal.getTombstoneById(created.memory_item_id, scopeB)).toBeUndefined();
    });
  });

  it("rejects kind-incompatible patch fields", async () => {
    await withOpenDal(fixture, async ({ dal, db }) => {
      const { scopeA } = await ensureAgentScopes(db);
      const created = await dal.create(
        factInput({
          key: "favorite_color",
          value: "blue",
          confidence: 0.9,
        }),
        scopeA,
      );

      await expect(
        dal.update(created.memory_item_id, { body_md: "should fail" }, scopeA),
      ).rejects.toThrow(/incompatible patch/i);
    });
  });

  it("self-heals when a tombstone exists but the item still exists", async () => {
    await withOpenDal(fixture, async ({ dal, db }) => {
      const { scopeA } = await ensureAgentScopes(db);
      const title = "On-call notes";
      const bodyMd = "Remember to check dashboards.";

      const created = await dal.create(
        noteInput({
          title,
          body_md: bodyMd,
        }),
        scopeA,
      );

      const tombstone = await dal.delete(created.memory_item_id, { deleted_by: "operator" }, scopeA);
      expect(await dal.getById(created.memory_item_id, scopeA)).toBeUndefined();

      await db.run(
        `INSERT INTO memory_items (
           tenant_id, agent_id, memory_item_id, kind, sensitivity,
           title, body_md,
           created_at, updated_at
         )
        VALUES (?, ?, ?, 'note', 'private', ?, ?, ?, NULL)`,
        [scopeA.tenantId, scopeA.agentId, created.memory_item_id, title, bodyMd, OBSERVED_AT],
      );
      await db.run(
        `INSERT INTO memory_item_provenance (
           tenant_id,
           agent_id,
           memory_item_id,
           source_kind,
           refs_json
         )
         VALUES (?, ?, ?, ?, ?)`,
        [scopeA.tenantId, scopeA.agentId, created.memory_item_id, "operator", "[]"],
      );

      expect(await dal.getById(created.memory_item_id, scopeA)).toBeDefined();

      const second = await dal.delete(created.memory_item_id, { deleted_by: "operator" }, scopeA);
      expect(second).toEqual(tombstone);
      expect(await dal.getById(created.memory_item_id, scopeA)).toBeUndefined();
    });
  });
}
