import { describe, expect, it, vi } from "vitest";
import {
  formatRelativeTime,
  memoryDeletedByLabel,
  memoryItemSummary,
  memoryKindBadgeVariant,
  memoryKindLabel,
  memorySensitivityBadgeVariant,
  type MemoryTab,
} from "../src/components/pages/memory-page.lib.js";
import {
  buildItemColumns,
  buildTombstoneColumns,
} from "../src/components/pages/memory-page.sections.js";
import type { MemoryItem, MemoryDeletedBy } from "@tyrum/contracts";

const BASE_ITEM = {
  v: 1 as const,
  memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
  agent_id: "00000000-0000-4000-8000-000000000002",
  tags: ["test"],
  sensitivity: "private" as const,
  provenance: { source_kind: "tool" as const, refs: [] },
  created_at: "2026-01-15T12:00:00Z",
};

describe("memory-page.lib", () => {
  describe("memoryKindLabel", () => {
    it("returns display labels for all kinds", () => {
      expect(memoryKindLabel("fact")).toBe("Fact");
      expect(memoryKindLabel("note")).toBe("Note");
      expect(memoryKindLabel("procedure")).toBe("Procedure");
      expect(memoryKindLabel("episode")).toBe("Episode");
    });
  });

  describe("memoryKindBadgeVariant", () => {
    it("maps kinds to badge variants", () => {
      expect(memoryKindBadgeVariant("fact")).toBe("default");
      expect(memoryKindBadgeVariant("note")).toBe("success");
      expect(memoryKindBadgeVariant("procedure")).toBe("outline");
      expect(memoryKindBadgeVariant("episode")).toBe("warning");
    });
  });

  describe("memorySensitivityBadgeVariant", () => {
    it("maps sensitivities to badge variants", () => {
      expect(memorySensitivityBadgeVariant("public")).toBe("default");
      expect(memorySensitivityBadgeVariant("private")).toBe("outline");
      expect(memorySensitivityBadgeVariant("sensitive")).toBe("warning");
    });
  });

  describe("memoryDeletedByLabel", () => {
    it("returns display labels for all deleted_by values", () => {
      const values: MemoryDeletedBy[] = ["user", "operator", "system", "budget", "consolidation"];
      for (const v of values) {
        expect(memoryDeletedByLabel(v)).toBeTypeOf("string");
        expect(memoryDeletedByLabel(v).length).toBeGreaterThan(0);
      }
    });
  });

  describe("memoryItemSummary", () => {
    it("summarizes a fact item", () => {
      const item: MemoryItem = {
        ...BASE_ITEM,
        kind: "fact",
        key: "favorite_color",
        value: "blue",
        confidence: 0.9,
        observed_at: "2026-01-15T12:00:00Z",
      };
      expect(memoryItemSummary(item)).toBe("favorite_color = blue");
    });

    it("summarizes a note item with title", () => {
      const item: MemoryItem = {
        ...BASE_ITEM,
        kind: "note",
        title: "My Note",
        body_md: "Some body text",
      };
      expect(memoryItemSummary(item)).toBe("My Note");
    });

    it("summarizes a note item without title", () => {
      const item: MemoryItem = {
        ...BASE_ITEM,
        kind: "note",
        body_md: "First line of body\nSecond line",
      };
      expect(memoryItemSummary(item)).toBe("First line of body");
    });

    it("summarizes a procedure item", () => {
      const item: MemoryItem = {
        ...BASE_ITEM,
        kind: "procedure",
        title: "Restart Steps",
        body_md: "1. Stop\n2. Start",
      };
      expect(memoryItemSummary(item)).toBe("Restart Steps");
    });

    it("summarizes an episode item", () => {
      const item: MemoryItem = {
        ...BASE_ITEM,
        kind: "episode",
        occurred_at: "2026-01-15T12:00:00Z",
        summary_md: "Investigated flaky tests",
      };
      expect(memoryItemSummary(item)).toBe("Investigated flaky tests");
    });

    it("truncates long values", () => {
      const item: MemoryItem = {
        ...BASE_ITEM,
        kind: "fact",
        key: "data",
        value: "x".repeat(200),
        confidence: 1,
        observed_at: "2026-01-15T12:00:00Z",
      };
      const summary = memoryItemSummary(item);
      expect(summary.length).toBeLessThanOrEqual(90);
    });
  });

  describe("formatRelativeTime", () => {
    it("returns 'just now' for recent dates", () => {
      const now = new Date().toISOString();
      expect(formatRelativeTime(now)).toBe("just now");
    });

    it("returns minutes for dates within an hour", () => {
      const date = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(formatRelativeTime(date)).toBe("5m ago");
    });

    it("returns hours for dates within a day", () => {
      const date = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(date)).toBe("3h ago");
    });

    it("returns days for dates within a month", () => {
      const date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      expect(formatRelativeTime(date)).toBe("7d ago");
    });

    it("returns future timestamps using the shared formatter behavior", () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"));
        expect(formatRelativeTime("2026-01-15T12:05:00.000Z")).toBe("in 5m");
      } finally {
        vi.useRealTimers();
      }
    });

    it("returns an empty string for invalid timestamps", () => {
      expect(formatRelativeTime("not-a-date")).toBe("");
    });
  });

  describe("MemoryTab type", () => {
    it("accepts valid tab values", () => {
      const items: MemoryTab = "items";
      const tombstones: MemoryTab = "tombstones";
      expect(items).toBe("items");
      expect(tombstones).toBe("tombstones");
    });
  });
});

describe("memory-page.sections", () => {
  describe("buildItemColumns", () => {
    it("returns 6 columns with expected ids", () => {
      const agentLookup = new Map([["agent-1", "default"]]);
      const columns = buildItemColumns({
        agentLookup,
        canMutate: false,
        onDelete: () => {},
      });
      expect(columns).toHaveLength(6);
      expect(columns.map((c) => c.id)).toEqual([
        "kind",
        "summary",
        "sensitivity",
        "agent",
        "created_at",
        "actions",
      ]);
    });

    it("provides sortValue for sortable columns", () => {
      const columns = buildItemColumns({
        agentLookup: new Map(),
        canMutate: true,
        onDelete: () => {},
      });
      const sortable = columns.filter((c) => c.sortValue);
      expect(sortable.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("buildTombstoneColumns", () => {
    it("returns 4 columns with expected ids", () => {
      const columns = buildTombstoneColumns(new Map());
      expect(columns).toHaveLength(4);
      expect(columns.map((c) => c.id)).toEqual(["agent", "deleted_by", "reason", "deleted_at"]);
    });

    it("sorts unknown agents by the visible fallback label", () => {
      const columns = buildTombstoneColumns(new Map());
      const agentColumn = columns.find((column) => column.id === "agent");
      expect(agentColumn?.sortValue).toBeDefined();

      const tombstone: MemoryTombstone = {
        v: 1,
        memory_item_id: "550e8400-e29b-41d4-a716-446655440010",
        agent_id: "550e8400-e29b-41d4-a716-446655440999",
        deleted_at: "2026-03-20T10:05:00.000Z",
        deleted_by: "operator",
        reason: "Operator deletion via UI",
      };

      expect(agentColumn?.sortValue?.(tombstone)).toBe("Unknown agent");
    });
  });

  describe("buildItemColumns", () => {
    it("sorts unknown agents by the visible fallback label", () => {
      const columns = buildItemColumns({
        agentLookup: new Map(),
        canMutate: true,
        onDelete: () => {},
      });
      const agentColumn = columns.find((column) => column.id === "agent");
      expect(agentColumn?.sortValue).toBeDefined();

      const item: MemoryItem = {
        ...BASE_ITEM,
        memory_item_id: "550e8400-e29b-41d4-a716-446655440020",
        kind: "note",
        title: "Visible label test",
        body_md: "Visible label test body",
      };

      expect(agentColumn?.sortValue?.(item)).toBe("Unknown agent");
    });
  });
});
