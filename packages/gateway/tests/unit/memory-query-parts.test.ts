import { describe, expect, it } from "vitest";
import { buildMemoryItemQueryParts } from "../../src/modules/memory/memory-dal.js";
import type { MemoryItemFilter } from "../../src/modules/memory/types.js";

function encodeCursor(cursor: { sort: string; id: string }): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64");
}

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const AGENT_ID = "00000000-0000-4000-8000-000000000002";

describe("buildMemoryItemQueryParts", () => {
  it("builds filters, provenance join, extra where, cursor, and clamps limit", () => {
    const filter: MemoryItemFilter = {
      kinds: ["fact", "note"],
      keys: ["favorite_color"],
      tags: ["prefs", "project"],
      provenance: {
        source_kinds: ["user"],
        channels: ["telegram"],
        thread_ids: ["123"],
        session_ids: ["agent:default:main"],
      },
    };

    const parts = buildMemoryItemQueryParts({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      filter,
      limit: 999,
      extraWhere: ["i.sensitivity = ?"],
      extraValues: ["private"],
      cursor: encodeCursor({ sort: "2026-02-20T00:00:00Z", id: "id-1" }),
    });

    expect(parts.limit).toBe(500);
    expect(parts.from).toContain("JOIN memory_item_provenance p");

    const tagsClause = parts.where.find((clause) => clause.includes("FROM memory_item_tags t"));
    expect(tagsClause).toBeTruthy();
    expect(tagsClause).toContain("t.tag IN (?, ?)");

    expect(parts.where).toContain("i.kind IN (?, ?)");
    expect(parts.where).toContain("i.key IN (?)");
    expect(parts.where).toContain("p.source_kind IN (?)");
    expect(parts.where).toContain("p.channel IN (?)");
    expect(parts.where).toContain("p.thread_id IN (?)");
    expect(parts.where).toContain("p.session_id IN (?)");
    expect(parts.where).toContain("i.sensitivity = ?");
    expect(parts.where).toContain(
      "(i.created_at < ? OR (i.created_at = ? AND i.memory_item_id < ?))",
    );

    expect(parts.values).toEqual([
      TENANT_ID,
      AGENT_ID,
      "fact",
      "note",
      "favorite_color",
      TENANT_ID,
      AGENT_ID,
      "prefs",
      "project",
      "user",
      "telegram",
      "123",
      "agent:default:main",
      "private",
      "2026-02-20T00:00:00Z",
      "2026-02-20T00:00:00Z",
      "id-1",
    ]);
  });

  it("applies sensitivities filter when provided", () => {
    const parts = buildMemoryItemQueryParts({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      filter: { sensitivities: ["private", "sensitive"] },
    });

    expect(parts.where).toContain("i.sensitivity IN (?, ?)");
    expect(parts.values).toEqual([TENANT_ID, AGENT_ID, "private", "sensitive"]);
  });

  it("avoids provenance join when provenance filter is empty", () => {
    const parts = buildMemoryItemQueryParts({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      filter: { provenance: { source_kinds: [] } },
      limit: 0,
    });

    expect(parts.from).toBe("memory_items i");
    expect(parts.limit).toBe(1);
    expect(parts.where).toEqual(["i.tenant_id = ?", "i.agent_id = ?"]);
    expect(parts.values).toEqual([TENANT_ID, AGENT_ID]);
  });

  it("normalizes filter arrays to avoid duplicate/blank SQL params", () => {
    const parts = buildMemoryItemQueryParts({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      filter: {
        kinds: ["note", "note", "fact"],
        keys: [" favorite_color ", "", "favorite_color"],
        tags: [" project", "project", ""],
        provenance: {
          source_kinds: ["user", "user"],
          channels: [" telegram ", "telegram", ""],
          thread_ids: [" 123 ", "123"],
          session_ids: [" agent:default:main ", "agent:default:main"],
        },
      },
    });

    expect(parts.where).toContain("i.kind IN (?, ?)");
    expect(parts.where).toContain("i.key IN (?)");
    expect(parts.where).toContain("p.source_kind IN (?)");
    expect(parts.where).toContain("p.channel IN (?)");
    expect(parts.where).toContain("p.thread_id IN (?)");
    expect(parts.where).toContain("p.session_id IN (?)");

    expect(parts.values).toEqual([
      TENANT_ID,
      AGENT_ID,
      "note",
      "fact",
      "favorite_color",
      TENANT_ID,
      AGENT_ID,
      "project",
      "user",
      "telegram",
      "123",
      "agent:default:main",
    ]);
  });

  it("can force provenance join for callers that always select provenance", () => {
    const parts = (
      buildMemoryItemQueryParts as unknown as (params: unknown) => {
        from: string;
      }
    )({
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      alwaysJoinProvenance: true,
    });

    expect(parts.from).toContain("JOIN memory_item_provenance p");
  });
});
