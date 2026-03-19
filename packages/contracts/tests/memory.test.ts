import { describe, expect, it } from "vitest";
import * as Schemas from "../src/index.js";

const AGENT_ID = "00000000-0000-4000-8000-000000000002";
const MEMORY_ITEM_ID = "550e8400-e29b-41d4-a716-446655440000";
const CREATED_AT = "2026-02-19T12:00:00Z";

describe("Memory contracts", () => {
  it("parses durable memory items", () => {
    const base = {
      v: 1,
      memory_item_id: MEMORY_ITEM_ID,
      agent_id: AGENT_ID,
      tags: ["project"],
      sensitivity: "private" as const,
      provenance: {
        source_kind: "user" as const,
        channel: "telegram",
        thread_id: "123",
        session_id: "agent:default:main",
      },
      created_at: CREATED_AT,
    };

    expect(
      Schemas.MemoryItem.parse({
        ...base,
        kind: "fact",
        key: "favorite_color",
        value: "blue",
        confidence: 0.9,
        observed_at: CREATED_AT,
      }).kind,
    ).toBe("fact");

    expect(
      Schemas.MemoryItem.parse({
        ...base,
        kind: "note",
        title: "On-call notes",
        body_md: "Remember to check dashboards.",
      }).kind,
    ).toBe("note");

    expect(
      Schemas.MemoryItem.parse({
        ...base,
        kind: "procedure",
        title: "Restart gateway",
        body_md: "1. Check logs\n2. Restart\n3. Verify health",
        confidence: 0.8,
      }).kind,
    ).toBe("procedure");

    expect(
      Schemas.MemoryItem.parse({
        ...base,
        kind: "episode",
        occurred_at: CREATED_AT,
        summary_md: "Investigated flaky tests and fixed root cause.",
      }).kind,
    ).toBe("episode");
  });

  it("rejects invalid durable memory item payloads", () => {
    expect(() =>
      Schemas.MemoryItem.parse({
        v: 1,
        memory_item_id: MEMORY_ITEM_ID,
        agent_id: AGENT_ID,
        kind: "note",
        body_md: "   ",
        tags: [],
        sensitivity: "private",
        provenance: {
          source_kind: "operator",
          refs: [],
        },
        created_at: CREATED_AT,
      }),
    ).toThrow();
  });

  it("parses tombstones", () => {
    const tombstone = Schemas.MemoryTombstone.parse({
      v: 1,
      memory_item_id: MEMORY_ITEM_ID,
      agent_id: AGENT_ID,
      deleted_at: CREATED_AT,
      deleted_by: "operator",
      reason: "user request",
    });

    expect(tombstone.deleted_by).toBe("operator");
  });

  it("parses MCP-native built-in memory tool arguments", () => {
    expect(
      Schemas.BuiltinMemorySeedArgs.parse({
        query: "recent preferences",
        turn: {
          session_id: "session-1",
          channel: "telegram",
        },
      }),
    ).toEqual({
      query: "recent preferences",
      turn: {
        session_id: "session-1",
        channel: "telegram",
      },
    });

    expect(
      Schemas.BuiltinMemorySearchArgs.parse({
        query: "restart",
        kinds: ["note", "procedure"],
        tags: ["ops", "project"],
        limit: 3,
      }),
    ).toEqual({
      query: "restart",
      kinds: ["note", "procedure"],
      tags: ["ops", "project"],
      limit: 3,
    });

    expect(
      Schemas.BuiltinMemoryWriteArgs.parse({
        kind: "fact",
        key: "favorite_color",
        value: "blue",
        confidence: 0.9,
        observed_at: CREATED_AT,
        tags: ["prefs"],
        sensitivity: "private",
      }),
    ).toMatchObject({
      kind: "fact",
      key: "favorite_color",
      sensitivity: "private",
    });

    expect(
      Schemas.BuiltinMemoryWriteArgs.parse({
        kind: "episode",
        summary_md: "Formatting fallback on outbound Telegram send.",
        tags: ["channel", "telegram"],
      }),
    ).toMatchObject({
      kind: "episode",
      summary_md: "Formatting fallback on outbound Telegram send.",
    });
  });

  it("rejects invalid MCP-native memory tool arguments", () => {
    expect(() =>
      Schemas.BuiltinMemorySearchArgs.parse({
        query: "restart",
        limit: 11,
      }),
    ).toThrow();

    expect(() =>
      Schemas.BuiltinMemoryWriteArgs.parse({
        kind: "note",
        body_md: "   ",
      }),
    ).toThrow();

    expect(() =>
      Schemas.BuiltinMemoryWriteArgs.parse({
        kind: "fact",
        key: "favorite_color",
        value: "blue",
        sensitivity: "sensitive",
      }),
    ).toThrow();
  });

  it("does not export retired CRUD/event memory contracts", () => {
    const removedExports = [
      "MemorySearchRequest",
      "MemorySearchResponse",
      "MemoryGetRequest",
      "MemoryGetResponse",
      "MemoryListRequest",
      "MemoryListResponse",
      "MemoryCreateRequest",
      "MemoryCreateResponse",
      "MemoryUpdateRequest",
      "MemoryUpdateResponse",
      "MemoryDeleteRequest",
      "MemoryDeleteResponse",
      "MemoryForgetRequest",
      "MemoryForgetResponse",
      "MemoryExportRequest",
      "MemoryExportResponse",
      "MemoryChangeEvent",
      "MemoryItemPatch",
      "MemorySearchHit",
      "MemoryItemFilter",
      "MemoryForgetSelector",
    ] as const;

    const schemas = Schemas as Record<string, unknown>;
    for (const exportName of removedExports) {
      expect(schemas[exportName]).toBeUndefined();
    }
  });
});
