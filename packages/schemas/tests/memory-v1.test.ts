import { describe, expect, it } from "vitest";
import * as Schemas from "../src/index.js";

function schema(name: string): any {
  return (Schemas as any)[name];
}

describe("Memory v1 contracts", () => {
  it("parses memory items (fact/note/procedure/episode)", () => {
    const MemoryItem = schema("MemoryItem");
    expect(MemoryItem).toBeDefined();
    if (!MemoryItem) return;

    const base = {
      v: 1,
      memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
      agent_id: "default",
      tags: ["project"],
      sensitivity: "private",
      provenance: {
        source_kind: "user",
        channel: "telegram",
        thread_id: "123",
        session_id: "agent:default:main",
      },
      created_at: "2026-02-19T12:00:00Z",
    } as const;

    expect(
      MemoryItem.parse({
        ...base,
        kind: "fact",
        key: "favorite_color",
        value: "blue",
        confidence: 0.9,
        observed_at: "2026-02-19T12:00:00Z",
      }).kind,
    ).toBe("fact");

    expect(
      MemoryItem.parse({
        ...base,
        kind: "note",
        title: "On-call notes",
        body_md: "Remember to check dashboards.",
      }).kind,
    ).toBe("note");

    expect(
      MemoryItem.parse({
        ...base,
        kind: "procedure",
        title: "Restart gateway",
        body_md: "1. Check logs\n2. Restart\n3. Verify health",
        confidence: 0.8,
      }).kind,
    ).toBe("procedure");

    expect(
      MemoryItem.parse({
        ...base,
        kind: "episode",
        occurred_at: "2026-02-19T12:00:00Z",
        summary_md: "Investigated flaky tests and fixed root cause.",
      }).kind,
    ).toBe("episode");
  });

  it("parses tombstones (deletion proof)", () => {
    const MemoryTombstone = schema("MemoryTombstone");
    expect(MemoryTombstone).toBeDefined();
    if (!MemoryTombstone) return;

    const tombstone = MemoryTombstone.parse({
      v: 1,
      memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
      agent_id: "default",
      deleted_at: "2026-02-19T12:00:00Z",
      deleted_by: "operator",
      reason: "user request",
    });

    expect(tombstone.deleted_by).toBe("operator");
  });

  it("parses search + CRUD request/response payloads", () => {
    const MemorySearchRequest = schema("MemorySearchRequest");
    const MemorySearchResponse = schema("MemorySearchResponse");
    const MemoryGetRequest = schema("MemoryGetRequest");
    const MemoryGetResponse = schema("MemoryGetResponse");
    const MemoryListRequest = schema("MemoryListRequest");
    const MemoryListResponse = schema("MemoryListResponse");
    const MemoryCreateRequest = schema("MemoryCreateRequest");
    const MemoryCreateResponse = schema("MemoryCreateResponse");
    const MemoryUpdateRequest = schema("MemoryUpdateRequest");
    const MemoryUpdateResponse = schema("MemoryUpdateResponse");
    const MemoryDeleteRequest = schema("MemoryDeleteRequest");
    const MemoryDeleteResponse = schema("MemoryDeleteResponse");
    const MemoryForgetRequest = schema("MemoryForgetRequest");
    const MemoryForgetResponse = schema("MemoryForgetResponse");
    const MemoryExportRequest = schema("MemoryExportRequest");
    const MemoryExportResponse = schema("MemoryExportResponse");

    expect(MemorySearchRequest).toBeDefined();
    expect(MemorySearchResponse).toBeDefined();
    expect(MemoryGetRequest).toBeDefined();
    expect(MemoryGetResponse).toBeDefined();
    expect(MemoryListRequest).toBeDefined();
    expect(MemoryListResponse).toBeDefined();
    expect(MemoryCreateRequest).toBeDefined();
    expect(MemoryCreateResponse).toBeDefined();
    expect(MemoryUpdateRequest).toBeDefined();
    expect(MemoryUpdateResponse).toBeDefined();
    expect(MemoryDeleteRequest).toBeDefined();
    expect(MemoryDeleteResponse).toBeDefined();
    expect(MemoryForgetRequest).toBeDefined();
    expect(MemoryForgetResponse).toBeDefined();
    expect(MemoryExportRequest).toBeDefined();
    expect(MemoryExportResponse).toBeDefined();

    if (!MemorySearchRequest || !MemorySearchResponse) return;
    if (!MemoryGetRequest || !MemoryGetResponse) return;
    if (!MemoryListRequest || !MemoryListResponse) return;
    if (!MemoryCreateRequest || !MemoryCreateResponse) return;
    if (!MemoryUpdateRequest || !MemoryUpdateResponse) return;
    if (!MemoryDeleteRequest || !MemoryDeleteResponse) return;
    if (!MemoryForgetRequest || !MemoryForgetResponse) return;
    if (!MemoryExportRequest || !MemoryExportResponse) return;

    MemorySearchRequest.parse({
      v: 1,
      query: "gateway restart",
      filter: { kinds: ["procedure"], tags: ["project"] },
      limit: 20,
    });
    MemorySearchResponse.parse({
      v: 1,
      hits: [
        {
          memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
          kind: "procedure",
          score: 0.42,
          snippet: "Restart gateway",
        },
      ],
    });

    MemoryGetRequest.parse({
      v: 1,
      memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    MemoryGetResponse.parse({
      v: 1,
      item: {
        v: 1,
        memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
        agent_id: "default",
        kind: "note",
        title: "Ops",
        body_md: "foo",
        tags: ["project"],
        sensitivity: "private",
        provenance: { source_kind: "operator" },
        created_at: "2026-02-19T12:00:00Z",
      },
    });

    MemoryListRequest.parse({
      v: 1,
      filter: { kinds: ["note"] },
      limit: 10,
    });
    MemoryListResponse.parse({
      v: 1,
      items: [
        {
          v: 1,
          memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
          agent_id: "default",
          kind: "note",
          title: "Ops",
          body_md: "foo",
          tags: ["project"],
          sensitivity: "private",
          provenance: { source_kind: "operator" },
          created_at: "2026-02-19T12:00:00Z",
        },
      ],
    });

    MemoryCreateRequest.parse({
      v: 1,
      item: {
        kind: "note",
        title: "Ops",
        body_md: "foo",
        tags: ["project"],
        sensitivity: "private",
        provenance: { source_kind: "operator" },
      },
    });
    MemoryCreateResponse.parse({
      v: 1,
      item: {
        v: 1,
        memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
        agent_id: "default",
        kind: "note",
        title: "Ops",
        body_md: "foo",
        tags: ["project"],
        sensitivity: "private",
        provenance: { source_kind: "operator" },
        created_at: "2026-02-19T12:00:00Z",
      },
    });

    MemoryUpdateRequest.parse({
      v: 1,
      memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
      patch: {
        tags: ["project", "ops"],
      },
    });
    MemoryUpdateResponse.parse({
      v: 1,
      item: {
        v: 1,
        memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
        agent_id: "default",
        kind: "note",
        title: "Ops",
        body_md: "foo",
        tags: ["project", "ops"],
        sensitivity: "private",
        provenance: { source_kind: "operator" },
        created_at: "2026-02-19T12:00:00Z",
        updated_at: "2026-02-19T12:30:00Z",
      },
    });

    MemoryDeleteRequest.parse({
      v: 1,
      memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
      reason: "test cleanup",
    });
    MemoryDeleteResponse.parse({
      v: 1,
      tombstone: {
        v: 1,
        memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
        agent_id: "default",
        deleted_at: "2026-02-19T12:00:00Z",
        deleted_by: "system",
        reason: "test cleanup",
      },
    });

    MemoryForgetRequest.parse({
      v: 1,
      confirm: "FORGET",
      selectors: [{ kind: "id", memory_item_id: "550e8400-e29b-41d4-a716-446655440000" }],
    });
    MemoryForgetRequest.parse({
      v: 1,
      confirm: "FORGET",
      selectors: [{ kind: "key", key: "favorite_color", item_kind: "fact" }],
    });
    MemoryForgetRequest.parse({
      v: 1,
      confirm: "FORGET",
      selectors: [{ kind: "tag", tag: "project" }],
    });
    MemoryForgetRequest.parse({
      v: 1,
      confirm: "FORGET",
      selectors: [{ kind: "provenance", provenance: { session_id: "agent:default:main" } }],
    });
    expect(() =>
      MemoryForgetRequest.parse({
        v: 1,
        confirm: "FORGET",
        selectors: [{ kind: "provenance", provenance: {} }],
      }),
    ).toThrow();
    MemoryForgetResponse.parse({
      v: 1,
      deleted_count: 1,
      tombstones: [
        {
          v: 1,
          memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
          agent_id: "default",
          deleted_at: "2026-02-19T12:00:00Z",
          deleted_by: "operator",
        },
      ],
    });

    MemoryExportRequest.parse({
      v: 1,
      filter: { kinds: ["note"] },
      include_tombstones: true,
    });
    MemoryExportResponse.parse({
      v: 1,
      artifact_id: "550e8400-e29b-41d4-a716-446655440000",
    });
  });

  it("parses memory change events", () => {
    const MemoryChangeEvent = schema("MemoryChangeEvent");
    expect(MemoryChangeEvent).toBeDefined();
    if (!MemoryChangeEvent) return;

    const item = {
      v: 1,
      memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
      agent_id: "default",
      kind: "note",
      title: "Ops",
      body_md: "foo",
      tags: ["project"],
      sensitivity: "private",
      provenance: { source_kind: "operator" },
      created_at: "2026-02-19T12:00:00Z",
    } as const;

    const tombstone = {
      v: 1,
      memory_item_id: "550e8400-e29b-41d4-a716-446655440000",
      agent_id: "default",
      deleted_at: "2026-02-19T12:00:00Z",
      deleted_by: "operator",
    } as const;

    MemoryChangeEvent.parse({
      v: 1,
      type: "memory.item.created",
      occurred_at: "2026-02-19T12:00:00Z",
      agent_id: "default",
      payload: { item },
    });
    MemoryChangeEvent.parse({
      v: 1,
      type: "memory.item.updated",
      occurred_at: "2026-02-19T12:05:00Z",
      agent_id: "default",
      payload: { item },
    });
    MemoryChangeEvent.parse({
      v: 1,
      type: "memory.item.deleted",
      occurred_at: "2026-02-19T12:10:00Z",
      agent_id: "default",
      payload: { tombstone },
    });
    MemoryChangeEvent.parse({
      v: 1,
      type: "memory.item.forgotten",
      occurred_at: "2026-02-19T12:15:00Z",
      agent_id: "default",
      payload: { tombstone },
    });
    MemoryChangeEvent.parse({
      v: 1,
      type: "memory.item.consolidated",
      occurred_at: "2026-02-19T12:20:00Z",
      agent_id: "default",
      payload: {
        from_memory_item_ids: [
          "550e8400-e29b-41d4-a716-446655440000",
          "550e8400-e29b-41d4-a716-446655440001",
        ],
        item,
      },
    });
  });
});
