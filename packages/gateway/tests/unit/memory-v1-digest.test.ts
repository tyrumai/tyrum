import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentConfig } from "@tyrum/schemas";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { MemoryV1Dal } from "../../src/modules/memory/v1-dal.js";
import { buildMemoryV1Digest } from "../../src/modules/memory/v1-digest.js";

describe("buildMemoryV1Digest", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("excludes sensitive items by default", async () => {
    const db = openTestSqliteDb();
    try {
      const dal = new MemoryV1Dal(db);
      const config = AgentConfig.parse({ model: { model: "openai/gpt-4.1" } }).memory.v1;

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));
      const visible = await dal.create(
        {
          kind: "note",
          title: "Food",
          body_md: "I like pizza.",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        "agent-a",
      );

      vi.setSystemTime(new Date("2026-02-27T00:01:00.000Z"));
      const hidden = await dal.create(
        {
          kind: "note",
          title: "Sensitive",
          body_md: "My SSN is 000-00-0000. I also like pizza.",
          tags: [],
          sensitivity: "sensitive",
          provenance: { source_kind: "user", refs: [] },
        },
        "agent-a",
      );

      const res = await buildMemoryV1Digest({
        dal,
        agentId: "agent-a",
        query: "pizza",
        config,
      });

      expect(res.digest).toContain(visible.memory_item_id);
      expect(res.digest).not.toContain(hidden.memory_item_id);
    } finally {
      await db.close();
    }
  });

  it("treats allow_sensitivities=[] as allow none", async () => {
    const db = openTestSqliteDb();
    try {
      const dal = new MemoryV1Dal(db);
      const base = AgentConfig.parse({ model: { model: "openai/gpt-4.1" } }).memory.v1;
      const config = { ...base, allow_sensitivities: [] } satisfies typeof base;

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));
      const item = await dal.create(
        {
          kind: "note",
          title: "Food",
          body_md: "I like pizza.",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        "agent-a",
      );

      const res = await buildMemoryV1Digest({
        dal,
        agentId: "agent-a",
        query: "pizza",
        config,
      });

      expect(res.included_item_ids).toHaveLength(0);
      expect(res.digest).not.toContain(item.memory_item_id);
    } finally {
      await db.close();
    }
  });

  it("enforces max_total_items deterministically", async () => {
    const db = openTestSqliteDb();
    try {
      const dal = new MemoryV1Dal(db);
      const base = AgentConfig.parse({ model: { model: "openai/gpt-4.1" } }).memory.v1;
      const config = {
        ...base,
        budgets: {
          ...base.budgets,
          max_total_items: 1,
          per_kind: {
            ...base.budgets.per_kind,
            note: { ...base.budgets.per_kind.note, max_items: 1 },
          },
        },
      } satisfies typeof base;

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));
      await dal.create(
        {
          kind: "note",
          title: "A",
          body_md: "pizza A",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        "agent-a",
      );
      vi.setSystemTime(new Date("2026-02-27T00:00:10.000Z"));
      await dal.create(
        {
          kind: "note",
          title: "B",
          body_md: "pizza B",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        "agent-a",
      );
      vi.setSystemTime(new Date("2026-02-27T00:00:20.000Z"));
      await dal.create(
        {
          kind: "note",
          title: "C",
          body_md: "pizza C",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        "agent-a",
      );

      const first = await buildMemoryV1Digest({
        dal,
        agentId: "agent-a",
        query: "pizza",
        config,
      });
      const second = await buildMemoryV1Digest({
        dal,
        agentId: "agent-a",
        query: "pizza",
        config,
      });

      expect(first.included_item_ids).toHaveLength(1);
      expect(second.included_item_ids).toEqual(first.included_item_ids);
      expect(second.digest).toBe(first.digest);
    } finally {
      await db.close();
    }
  });

  it("orders keyword hits by score then created_at deterministically", async () => {
    const db = openTestSqliteDb();
    try {
      const dal = new MemoryV1Dal(db);
      const config = AgentConfig.parse({ model: { model: "openai/gpt-4.1" } }).memory.v1;

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));
      const older = await dal.create(
        {
          kind: "note",
          title: "Older",
          body_md: "pizza",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        "agent-a",
      );

      vi.setSystemTime(new Date("2026-02-27T00:10:00.000Z"));
      const newer = await dal.create(
        {
          kind: "note",
          title: "Newer",
          body_md: "pizza",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        "agent-a",
      );

      const res = await buildMemoryV1Digest({
        dal,
        agentId: "agent-a",
        query: "pizza",
        config: {
          ...config,
          budgets: {
            ...config.budgets,
            max_total_items: 2,
            per_kind: {
              ...config.budgets.per_kind,
              note: { ...config.budgets.per_kind.note, max_items: 2 },
            },
          },
        },
      });

      expect(res.included_item_ids).toEqual([newer.memory_item_id, older.memory_item_id]);

      const newerIdx = res.digest.indexOf(newer.memory_item_id);
      const olderIdx = res.digest.indexOf(older.memory_item_id);
      expect(newerIdx).toBeGreaterThanOrEqual(0);
      expect(olderIdx).toBeGreaterThanOrEqual(0);
      expect(newerIdx).toBeLessThan(olderIdx);
    } finally {
      await db.close();
    }
  });

  it("is best-effort when keyword search rejects the query", async () => {
    const db = openTestSqliteDb();
    try {
      const dal = new MemoryV1Dal(db);
      const base = AgentConfig.parse({ model: { model: "openai/gpt-4.1" } }).memory.v1;
      const config = {
        ...base,
        structured: {
          ...base.structured,
          fact_keys: ["favorite_color"],
        },
      } satisfies typeof base;

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));
      const fact = await dal.create(
        {
          kind: "fact",
          key: "favorite_color",
          value: "blue",
          observed_at: "2026-02-27T00:00:00.000Z",
          confidence: 0.9,
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        "agent-a",
      );

      const longQuery = "pizza ".repeat(300);
      expect(longQuery.length).toBeGreaterThan(1024);

      const res = await buildMemoryV1Digest({
        dal,
        agentId: "agent-a",
        query: longQuery,
        config,
      });

      expect(res.digest).toContain(fact.memory_item_id);
      expect(res.structured_item_count).toBe(1);
      expect(res.keyword_hit_count).toBe(0);
    } finally {
      await db.close();
    }
  });

  it("deduplicates structured tag results against fact_keys results", async () => {
    const db = openTestSqliteDb();
    try {
      const dal = new MemoryV1Dal(db);
      const base = AgentConfig.parse({ model: { model: "openai/gpt-4.1" } }).memory.v1;
      const config = {
        ...base,
        structured: {
          ...base.structured,
          fact_keys: ["favorite_color"],
          tags: ["prefs"],
        },
      } satisfies typeof base;

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));
      await dal.create(
        {
          kind: "fact",
          key: "favorite_color",
          value: "blue",
          observed_at: "2026-02-27T00:00:00.000Z",
          confidence: 0.9,
          tags: ["prefs"],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        "agent-a",
      );

      const res = await buildMemoryV1Digest({
        dal,
        agentId: "agent-a",
        query: "",
        config,
      });

      expect(res.structured_item_count).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("skips keyword candidates when dal.getById throws", async () => {
    const db = openTestSqliteDb();
    try {
      const dal = new MemoryV1Dal(db);
      const config = AgentConfig.parse({ model: { model: "openai/gpt-4.1" } }).memory.v1;

      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));
      const older = await dal.create(
        {
          kind: "note",
          title: "Older",
          body_md: "pizza",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        "agent-a",
      );

      vi.setSystemTime(new Date("2026-02-27T00:10:00.000Z"));
      const newer = await dal.create(
        {
          kind: "note",
          title: "Newer",
          body_md: "pizza",
          tags: [],
          sensitivity: "private",
          provenance: { source_kind: "user", refs: [] },
        },
        "agent-a",
      );

      const original = dal.getById.bind(dal);
      vi.spyOn(dal, "getById").mockImplementation(async (id, agentId) => {
        if (id === newer.memory_item_id) throw new Error("boom");
        return await original(id, agentId);
      });

      const res = await buildMemoryV1Digest({
        dal,
        agentId: "agent-a",
        query: "pizza",
        config: {
          ...config,
          budgets: {
            ...config.budgets,
            max_total_items: 2,
            per_kind: {
              ...config.budgets.per_kind,
              note: { ...config.budgets.per_kind.note, max_items: 2 },
            },
          },
        },
      });

      expect(res.included_item_ids).toContain(older.memory_item_id);
      expect(res.digest).toContain(older.memory_item_id);
      expect(res.digest).not.toContain(newer.memory_item_id);
    } finally {
      await db.close();
    }
  });
});
