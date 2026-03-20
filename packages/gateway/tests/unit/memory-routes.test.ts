import { Hono } from "hono";
import type { MemoryItem, MemoryTombstone } from "@tyrum/contracts";
import { describe, expect, it, vi } from "vitest";
import { createMemoryRoutes } from "../../src/routes/memory.js";

function createNoteItem(memoryItemId: string, title: string): MemoryItem {
  return {
    v: 1,
    memory_item_id: memoryItemId,
    agent_id: "00000000-0000-4000-8000-000000000002",
    kind: "note",
    title,
    body_md: `${title} body`,
    tags: ["ops"],
    sensitivity: "private",
    provenance: { source_kind: "tool", refs: [] },
    created_at: "2026-03-20T10:00:00.000Z",
  };
}

function createTombstone(item: MemoryItem, reason?: string): MemoryTombstone {
  return {
    v: 1,
    memory_item_id: item.memory_item_id,
    agent_id: item.agent_id,
    deleted_at: "2026-03-20T10:05:00.000Z",
    deleted_by: "operator",
    ...(reason ? { reason } : {}),
  };
}

function createAuthedApp(memoryDal: Parameters<typeof createMemoryRoutes>[0]["memoryDal"]): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authClaims", {
      token_kind: "tenant",
      token_id: "tenant-token-1",
      tenant_id: "tenant-1",
      role: "admin",
      scopes: ["*"],
    });
    await next();
  });
  app.route("/", createMemoryRoutes({ memoryDal }));
  return app;
}

describe("createMemoryRoutes", () => {
  it("lists memory items with parsed filters and pagination", async () => {
    const item = createNoteItem("550e8400-e29b-41d4-a716-446655440000", "Operational note");
    const list = vi.fn(async () => ({ items: [item], next_cursor: "next-cursor" }));
    const app = createAuthedApp({
      list,
      getById: vi.fn(),
      search: vi.fn(),
      delete: vi.fn(),
      listTombstones: vi.fn(),
    } as never);

    const response = await app.request(
      "/memory/items?agent_id=agent-1&kinds=note&kinds=fact&tags=ops&sensitivities=private&limit=25&cursor=cursor-1",
    );

    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      agentId: "agent-1",
      filter: {
        kinds: ["note", "fact"],
        tags: ["ops"],
        sensitivities: ["private"],
      },
      limit: 25,
      cursor: "cursor-1",
    });
    expect(await response.json()).toEqual({ items: [item], next_cursor: "next-cursor" });
  });

  it("gets memory items by id and returns not_found for missing items", async () => {
    const item = createNoteItem("550e8400-e29b-41d4-a716-446655440001", "Found note");
    const getById = vi.fn(async (memoryItemId: string) =>
      memoryItemId === item.memory_item_id ? item : undefined,
    );
    const app = createAuthedApp({
      list: vi.fn(),
      getById,
      search: vi.fn(),
      delete: vi.fn(),
      listTombstones: vi.fn(),
    } as never);

    const foundResponse = await app.request(
      `/memory/items/${item.memory_item_id}?agent_id=agent-2`,
    );
    const missingResponse = await app.request("/memory/items/missing-item");

    expect(foundResponse.status).toBe(200);
    expect(getById).toHaveBeenNthCalledWith(1, item.memory_item_id, {
      tenantId: "tenant-1",
      agentId: "agent-2",
    });
    expect(await foundResponse.json()).toEqual({ item });

    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({
      error: "not_found",
      message: "memory item not found",
    });
  });

  it("validates search queries and forwards parsed search filters", async () => {
    const search = vi.fn(async () => ({
      v: 1 as const,
      hits: [{ memory_item_id: "550e8400-e29b-41d4-a716-446655440002", kind: "note", score: 0.9 }],
    }));
    const app = createAuthedApp({
      list: vi.fn(),
      getById: vi.fn(),
      search,
      delete: vi.fn(),
      listTombstones: vi.fn(),
    } as never);

    const invalidResponse = await app.request("/memory/search?query=%20%20");
    const validResponse = await app.request(
      "/memory/search?agent_id=agent-3&query=memory&kinds=note&tags=ops&sensitivities=private&limit=not-a-number",
    );

    expect(invalidResponse.status).toBe(400);
    expect(await invalidResponse.json()).toEqual({
      error: "invalid_request",
      message: "query parameter is required",
    });

    expect(validResponse.status).toBe(200);
    expect(search).toHaveBeenCalledWith(
      {
        query: "memory",
        filter: {
          kinds: ["note"],
          tags: ["ops"],
          sensitivities: ["private"],
        },
        limit: undefined,
      },
      {
        tenantId: "tenant-1",
        agentId: "agent-3",
      },
    );
  });

  it("deletes memory items with an optional reason and maps not_found errors", async () => {
    const deletedWithReason = createTombstone(
      createNoteItem("550e8400-e29b-41d4-a716-446655440003", "Delete me"),
      "Operator deletion via UI",
    );
    const deletedWithoutReason = createTombstone(
      createNoteItem("550e8400-e29b-41d4-a716-446655440004", "Delete me too"),
    );
    const deleteMemoryItem = vi.fn(
      async (memoryItemId: string, _options: { deleted_by: string; reason?: string }) => {
        if (memoryItemId === deletedWithReason.memory_item_id) return deletedWithReason;
        if (memoryItemId === deletedWithoutReason.memory_item_id) return deletedWithoutReason;
        throw new Error("memory item not found");
      },
    );
    const app = createAuthedApp({
      list: vi.fn(),
      getById: vi.fn(),
      search: vi.fn(),
      delete: deleteMemoryItem,
      listTombstones: vi.fn(),
    } as never);

    const reasonResponse = await app.request(`/memory/items/${deletedWithReason.memory_item_id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "  Operator deletion via UI  " }),
    });
    const noBodyResponse = await app.request(
      `/memory/items/${deletedWithoutReason.memory_item_id}`,
      {
        method: "DELETE",
      },
    );
    const missingResponse = await app.request("/memory/items/missing-item", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "missing" }),
    });

    expect(reasonResponse.status).toBe(200);
    expect(deleteMemoryItem).toHaveBeenNthCalledWith(
      1,
      deletedWithReason.memory_item_id,
      { deleted_by: "operator", reason: "Operator deletion via UI" },
      { tenantId: "tenant-1", agentId: undefined },
    );
    expect(await reasonResponse.json()).toEqual({ tombstone: deletedWithReason });

    expect(noBodyResponse.status).toBe(200);
    expect(deleteMemoryItem).toHaveBeenNthCalledWith(
      2,
      deletedWithoutReason.memory_item_id,
      { deleted_by: "operator", reason: undefined },
      { tenantId: "tenant-1", agentId: undefined },
    );
    expect(await noBodyResponse.json()).toEqual({ tombstone: deletedWithoutReason });

    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({
      error: "not_found",
      message: "memory item not found",
    });
  });

  it("lists memory tombstones with parsed pagination", async () => {
    const item = createNoteItem("550e8400-e29b-41d4-a716-446655440005", "Deleted note");
    const tombstone = createTombstone(item, "cleanup");
    const listTombstones = vi.fn(async () => ({ tombstones: [tombstone], next_cursor: "next" }));
    const app = createAuthedApp({
      list: vi.fn(),
      getById: vi.fn(),
      search: vi.fn(),
      delete: vi.fn(),
      listTombstones,
    } as never);

    const response = await app.request(
      "/memory/tombstones?agent_id=agent-4&limit=50&cursor=tombstone-cursor",
    );

    expect(response.status).toBe(200);
    expect(listTombstones).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      agentId: "agent-4",
      limit: 50,
      cursor: "tombstone-cursor",
    });
    expect(await response.json()).toEqual({ tombstones: [tombstone], next_cursor: "next" });
  });
});
