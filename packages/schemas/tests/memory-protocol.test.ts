import { describe, expect, it } from "vitest";
import * as Schemas from "../src/index.js";
import * as Protocol from "../src/protocol.js";
import { WsEvent, WsRequest, WsResponse } from "../src/protocol.js";

describe("Memory v1 WS protocol", () => {
  it("exports Memory v1 schemas from @tyrum/schemas", () => {
    expect("MemoryItem" in Schemas).toBe(true);
    expect("MemoryTombstone" in Schemas).toBe(true);
    expect("MemorySearchRequest" in Schemas).toBe(true);
    expect("WsMemorySearchRequest" in Schemas).toBe(true);
    expect("WsMemoryGetRequest" in Schemas).toBe(true);
    expect("WsMemoryItemCreatedEvent" in Schemas).toBe(true);
  });

  it("exports memory.* WS operation/event schemas from ../src/protocol.js", () => {
    expect("WsMemorySearchRequest" in Protocol).toBe(true);
    expect("WsMemoryGetRequest" in Protocol).toBe(true);
    expect("WsMemoryItemCreatedEvent" in Protocol).toBe(true);
  });

  it("parses memory.* requests via WsRequest union", () => {
    const memoryItemId = "550e8400-e29b-41d4-a716-446655440000";

    const requests: Array<{ type: string; payload: unknown }> = [
      {
        type: "memory.search",
        payload: { v: 1, query: "gateway restart", filter: { kinds: ["procedure"] }, limit: 20 },
      },
      { type: "memory.list", payload: { v: 1, filter: { kinds: ["note"] }, limit: 50 } },
      { type: "memory.get", payload: { v: 1, memory_item_id: memoryItemId } },
      {
        type: "memory.create",
        payload: {
          v: 1,
          item: {
            kind: "note",
            body_md: "Remember to check dashboards.",
            provenance: { source_kind: "operator" },
          },
        },
      },
      { type: "memory.update", payload: { v: 1, memory_item_id: memoryItemId, patch: {} } },
      { type: "memory.delete", payload: { v: 1, memory_item_id: memoryItemId } },
      {
        type: "memory.forget",
        payload: { v: 1, confirm: "FORGET", selectors: [{ kind: "tag", tag: "project" }] },
      },
      { type: "memory.export", payload: { v: 1, filter: { kinds: ["fact"] } } },
    ];

    for (const entry of requests) {
      const parsed = WsRequest.safeParse({
        request_id: `r-${entry.type}`,
        type: entry.type,
        payload: entry.payload,
      });
      expect(parsed.success, entry.type).toBe(true);
    }
  });

  it("parses memory.* responses via WsResponse union", () => {
    const memoryItemId = "550e8400-e29b-41d4-a716-446655440000";
    const artifactId = "123e4567-e89b-12d3-a456-426614174000";

    const memoryItem = {
      v: 1,
      memory_item_id: memoryItemId,
      agent_id: "default",
      kind: "note",
      title: "Ops",
      body_md: "foo",
      tags: ["project"],
      sensitivity: "private",
      provenance: { source_kind: "user" },
      created_at: "2026-02-19T12:00:00Z",
    };

    const tombstone = {
      v: 1,
      memory_item_id: memoryItemId,
      agent_id: "default",
      deleted_at: "2026-02-19T12:00:00Z",
      deleted_by: "operator",
      reason: "user request",
    };

    const responses: Array<{ type: string; result?: unknown }> = [
      { type: "memory.search", result: { v: 1, hits: [] } },
      { type: "memory.list", result: { v: 1, items: [] } },
      { type: "memory.get", result: { v: 1, item: memoryItem } },
      { type: "memory.create", result: { v: 1, item: memoryItem } },
      { type: "memory.update", result: { v: 1, item: memoryItem } },
      { type: "memory.delete", result: { v: 1, tombstone } },
      { type: "memory.forget", result: { v: 1, deleted_count: 1, tombstones: [tombstone] } },
      { type: "memory.export", result: { v: 1, artifact_id: artifactId } },
    ];

    for (const entry of responses) {
      const parsed = WsResponse.safeParse({
        request_id: `r-${entry.type}`,
        type: entry.type,
        ok: true,
        result: entry.result,
      });
      expect(parsed.success, entry.type).toBe(true);
    }

    const errorResponses: Array<{ type: string }> = [
      { type: "memory.search" },
      { type: "memory.list" },
      { type: "memory.get" },
      { type: "memory.create" },
      { type: "memory.update" },
      { type: "memory.delete" },
      { type: "memory.forget" },
      { type: "memory.export" },
    ];

    for (const entry of errorResponses) {
      const parsed = WsResponse.safeParse({
        request_id: `r-err-${entry.type}`,
        type: entry.type,
        ok: false,
        error: { code: "bad_request", message: "boom" },
      });
      expect(parsed.success, entry.type).toBe(true);
    }
  });

  it("parses memory.* events via WsEvent union", () => {
    const memoryItemId = "550e8400-e29b-41d4-a716-446655440000";
    const artifactId = "123e4567-e89b-12d3-a456-426614174000";

    const memoryItem = {
      v: 1,
      memory_item_id: memoryItemId,
      agent_id: "default",
      kind: "note",
      title: "Ops",
      body_md: "foo",
      tags: ["project"],
      sensitivity: "private",
      provenance: { source_kind: "user" },
      created_at: "2026-02-19T12:00:00Z",
    };

    const tombstone = {
      v: 1,
      memory_item_id: memoryItemId,
      agent_id: "default",
      deleted_at: "2026-02-19T12:00:00Z",
      deleted_by: "operator",
    };

    const events: Array<{ type: string; payload: unknown }> = [
      { type: "memory.item.created", payload: { item: memoryItem } },
      { type: "memory.item.updated", payload: { item: memoryItem } },
      { type: "memory.item.deleted", payload: { tombstone } },
      { type: "memory.item.forgotten", payload: { tombstone } },
      {
        type: "memory.item.consolidated",
        payload: { from_memory_item_ids: [memoryItemId], item: memoryItem },
      },
      { type: "memory.export.completed", payload: { artifact_id: artifactId } },
    ];

    for (const entry of events) {
      const parsed = WsEvent.safeParse({
        event_id: `e-${entry.type}`,
        type: entry.type,
        occurred_at: "2026-02-19T12:00:00Z",
        payload: entry.payload,
      });
      expect(parsed.success, entry.type).toBe(true);
    }
  });
});
