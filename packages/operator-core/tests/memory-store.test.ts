import { describe, expect, it, vi } from "vitest";
import type { MemoryItem, MemorySearchHit, MemoryTombstone } from "@tyrum/schemas";
import type { TyrumHttpClient } from "@tyrum/client";
import { createBearerTokenAuth, createOperatorCore } from "../src/index.js";

type Handler = (data: unknown) => void;

class FakeWsClient {
  connected = true;
  private readonly handlers = new Map<string, Set<Handler>>();

  connect = vi.fn(() => {});
  disconnect = vi.fn(() => {});
  approvalList = vi.fn(async () => ({ approvals: [], next_cursor: undefined }));
  approvalResolve = vi.fn(async () => ({ approval: { approval_id: 1 } as unknown }));

  memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }));
  memorySearch = vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined }));
  memoryGet = vi.fn(async () => ({ v: 1, item: sampleNote("x", "noop") }));
  memoryForget = vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] }));
  memoryExport = vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" }));

  on(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (existing) {
      existing.add(handler);
      return;
    }
    this.handlers.set(event, new Set([handler]));
  }

  off(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (!existing) return;
    existing.delete(handler);
    if (existing.size === 0) {
      this.handlers.delete(event);
    }
  }

  emit(event: string, data: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(data);
    }
  }
}

function createFakeHttpClient(): Pick<
  TyrumHttpClient,
  "status" | "usage" | "presence" | "pairings"
> {
  return {
    status: { get: vi.fn(async () => ({ status: "ok" }) as unknown) },
    usage: { get: vi.fn(async () => ({ status: "ok" }) as unknown) },
    presence: {
      list: vi.fn(async () => ({ status: "ok", generated_at: "", entries: [] }) as unknown),
    },
    pairings: {
      list: vi.fn(async () => ({ status: "ok", pairings: [] }) as unknown),
      approve: vi.fn(async () => ({ status: "ok" }) as unknown),
      deny: vi.fn(async () => ({ status: "ok" }) as unknown),
      revoke: vi.fn(async () => ({ status: "ok" }) as unknown),
    },
  };
}

function sampleNote(memoryItemId: string, body: string): MemoryItem {
  return {
    v: 1,
    memory_item_id: memoryItemId,
    agent_id: "agent-1",
    kind: "note",
    tags: ["demo"],
    sensitivity: "private",
    provenance: { source_kind: "operator", refs: [] },
    created_at: "2026-02-19T12:00:00Z",
    body_md: body,
  };
}

function sampleHit(memoryItemId: string, kind: MemoryItem["kind"]): MemorySearchHit {
  return { memory_item_id: memoryItemId, kind, score: 1 };
}

function sampleTombstone(memoryItemId: string): MemoryTombstone {
  return {
    v: 1,
    memory_item_id: memoryItemId,
    agent_id: "agent-1",
    deleted_at: "2026-02-19T12:00:01Z",
    deleted_by: "operator",
    reason: "cleanup",
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("memoryStore", () => {
  it("lists memory items and paginates", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174000", "A");
    const itemB = sampleNote("123e4567-e89b-12d3-a456-426614174001", "B");

    const page1 = deferred<{ v: 1; items: MemoryItem[]; next_cursor?: string }>();
    const page2 = deferred<{ v: 1; items: MemoryItem[]; next_cursor?: string }>();
    ws.memoryList = vi.fn(async (payload: unknown) => {
      const cursor = (payload as { cursor?: string }).cursor;
      return cursor ? await page2.promise : await page1.promise;
    });

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    const listP = core.memoryStore.list({ limit: 1 });
    expect(core.memoryStore.getSnapshot().browse.loading).toBe(true);

    page1.resolve({ v: 1, items: [itemA], next_cursor: "c1" });
    await listP;

    expect(ws.memoryList).toHaveBeenCalledWith({
      v: 1,
      limit: 1,
      filter: undefined,
      cursor: undefined,
    });
    expect(core.memoryStore.getSnapshot().browse.loading).toBe(false);
    expect(core.memoryStore.getSnapshot().browse.results).toEqual({
      kind: "list",
      items: [itemA],
      nextCursor: "c1",
    });

    const moreP = core.memoryStore.loadMore();
    expect(core.memoryStore.getSnapshot().browse.loading).toBe(true);

    page2.resolve({ v: 1, items: [itemB] });
    await moreP;

    expect(ws.memoryList).toHaveBeenCalledWith({ v: 1, limit: 1, filter: undefined, cursor: "c1" });
    expect(core.memoryStore.getSnapshot().browse.results).toEqual({
      kind: "list",
      items: [itemA, itemB],
      nextCursor: null,
    });
  });

  it("does not reorder a consolidated item when consolidation arrives during loadMore", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174030", "A");
    const itemB = sampleNote("123e4567-e89b-12d3-a456-426614174031", "B");
    const itemAfter = sampleNote("123e4567-e89b-12d3-a456-426614174032", "after");
    const consolidated = sampleNote("123e4567-e89b-12d3-a456-426614174039", "C");
    const itemC = sampleNote("123e4567-e89b-12d3-a456-426614174033", "C2");

    const page1 = deferred<{ v: 1; items: MemoryItem[]; next_cursor?: string }>();
    const page2 = deferred<{ v: 1; items: MemoryItem[]; next_cursor?: string }>();
    ws.memoryList = vi.fn(async (payload: unknown) => {
      const cursor = (payload as { cursor?: string }).cursor;
      return cursor ? await page2.promise : await page1.promise;
    });

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    const listP = core.memoryStore.list();
    page1.resolve({ v: 1, items: [itemA, itemB, itemAfter], next_cursor: "c1" });
    await listP;

    const moreP = core.memoryStore.loadMore();
    expect(core.memoryStore.getSnapshot().browse.loading).toBe(true);

    ws.emit("memory.item.consolidated", {
      payload: {
        from_memory_item_ids: [itemA.memory_item_id, itemB.memory_item_id],
        item: consolidated,
      },
    });

    page2.resolve({ v: 1, items: [itemB, itemC] });
    await moreP;

    expect(core.memoryStore.getSnapshot().browse.results).toEqual({
      kind: "list",
      items: [consolidated, itemAfter, itemC],
      nextCursor: null,
    });
  });

  it("searches memory and paginates hits", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const hitA = sampleHit("123e4567-e89b-12d3-a456-426614174010", "note");
    const hitB = sampleHit("123e4567-e89b-12d3-a456-426614174011", "fact");

    const page1 = deferred<{ v: 1; hits: MemorySearchHit[]; next_cursor?: string }>();
    const page2 = deferred<{ v: 1; hits: MemorySearchHit[]; next_cursor?: string }>();
    ws.memorySearch = vi.fn(async (payload: unknown) => {
      const cursor = (payload as { cursor?: string }).cursor;
      return cursor ? await page2.promise : await page1.promise;
    });

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    const searchP = core.memoryStore.search({ query: "hello", limit: 1 });
    expect(core.memoryStore.getSnapshot().browse.loading).toBe(true);

    page1.resolve({ v: 1, hits: [hitA], next_cursor: "c1" });
    await searchP;

    expect(ws.memorySearch).toHaveBeenCalledWith({
      v: 1,
      query: "hello",
      limit: 1,
      filter: undefined,
      cursor: undefined,
    });
    expect(core.memoryStore.getSnapshot().browse.results).toEqual({
      kind: "search",
      hits: [hitA],
      nextCursor: "c1",
    });

    const moreP = core.memoryStore.loadMore();
    page2.resolve({ v: 1, hits: [hitB] });
    await moreP;

    expect(ws.memorySearch).toHaveBeenCalledWith({
      v: 1,
      query: "hello",
      limit: 1,
      filter: undefined,
      cursor: "c1",
    });
    expect(core.memoryStore.getSnapshot().browse.results).toEqual({
      kind: "search",
      hits: [hitA, hitB],
      nextCursor: null,
    });
  });

  it("inspects a selected memory item", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const item = sampleNote("123e4567-e89b-12d3-a456-426614174099", "Inspect me");
    const getP = deferred<{ v: 1; item: MemoryItem }>();
    ws.memoryGet = vi.fn(async () => await getP.promise);

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    const inspectP = core.memoryStore.inspect(item.memory_item_id);
    expect(core.memoryStore.getSnapshot().inspect.loading).toBe(true);

    getP.resolve({ v: 1, item });
    await inspectP;

    expect(ws.memoryGet).toHaveBeenCalledWith({ v: 1, memory_item_id: item.memory_item_id });
    expect(core.memoryStore.getSnapshot().inspect.item).toEqual(item);
    expect(core.memoryStore.getSnapshot().inspect.loading).toBe(false);
  });

  it("does not resurrect an item after it is forgotten while inspect is in-flight", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const item = sampleNote("123e4567-e89b-12d3-a456-426614174150", "Inspect me");
    const tombstone = sampleTombstone(item.memory_item_id);

    const getP = deferred<{ v: 1; item: MemoryItem }>();
    ws.memoryGet = vi.fn(async () => await getP.promise);
    ws.memoryForget = vi.fn(async () => ({ v: 1, deleted_count: 1, tombstones: [tombstone] }));

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    const inspectP = core.memoryStore.inspect(item.memory_item_id);
    expect(core.memoryStore.getSnapshot().inspect.loading).toBe(true);

    await core.memoryStore.forget([{ kind: "id", memory_item_id: item.memory_item_id }]);
    expect(core.memoryStore.getSnapshot().inspect.item).toBe(null);

    getP.resolve({ v: 1, item });
    await inspectP;

    expect(core.memoryStore.getSnapshot().inspect.item).toBe(null);
  });

  it("applies memory events received during a list load to the final results", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174300", "old");
    const itemAUpdated: MemoryItem = {
      ...itemA,
      body_md: "new",
      updated_at: "2026-02-19T12:00:02Z",
    };
    const itemB = sampleNote("123e4567-e89b-12d3-a456-426614174301", "B");
    const tombstoneB = sampleTombstone(itemB.memory_item_id);

    const page = deferred<{ v: 1; items: MemoryItem[]; next_cursor?: string }>();
    ws.memoryList = vi.fn(async () => await page.promise);

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    const listP = core.memoryStore.list();
    expect(core.memoryStore.getSnapshot().browse.loading).toBe(true);

    ws.emit("memory.item.updated", { payload: { item: itemAUpdated } });
    ws.emit("memory.item.deleted", { payload: { tombstone: tombstoneB } });

    page.resolve({ v: 1, items: [itemA, itemB] });
    await listP;

    expect(core.memoryStore.getSnapshot().browse.results).toEqual({
      kind: "list",
      items: [itemAUpdated],
      nextCursor: null,
    });
  });

  it("applies consolidation events received during a list load at the correct position", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const consolidated = sampleNote("123e4567-e89b-12d3-a456-426614174310", "old");
    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174311", "A");
    const itemB = sampleNote("123e4567-e89b-12d3-a456-426614174312", "B");
    const itemAfter = sampleNote("123e4567-e89b-12d3-a456-426614174313", "after");
    const consolidatedUpdated: MemoryItem = {
      ...consolidated,
      body_md: "new",
      updated_at: "2026-02-19T12:00:02Z",
    };

    const page = deferred<{ v: 1; items: MemoryItem[]; next_cursor?: string }>();
    ws.memoryList = vi.fn(async () => await page.promise);

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    const listP = core.memoryStore.list();
    expect(core.memoryStore.getSnapshot().browse.loading).toBe(true);

    ws.emit("memory.item.consolidated", {
      payload: {
        from_memory_item_ids: [itemA.memory_item_id, itemB.memory_item_id],
        item: consolidatedUpdated,
      },
    });

    page.resolve({ v: 1, items: [consolidated, itemA, itemB, itemAfter] });
    await listP;

    expect(core.memoryStore.getSnapshot().browse.results).toEqual({
      kind: "list",
      items: [consolidatedUpdated, itemAfter],
      nextCursor: null,
    });
  });

  it("does not notify subscribers when an upsert arrives for an item not in the list results", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174320", "A");
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [itemA] }));

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    await core.memoryStore.list();

    const before = core.memoryStore.getSnapshot();

    let notifications = 0;
    const unsubscribe = core.memoryStore.subscribe(() => {
      notifications++;
    });

    const offPage = sampleNote("123e4567-e89b-12d3-a456-426614174321", "off-page");
    ws.emit("memory.item.updated", { payload: { item: offPage } });

    unsubscribe();

    expect(notifications).toBe(0);
    expect(core.memoryStore.getSnapshot()).toBe(before);
  });

  it("removes consolidated-from items from list results and inserts the consolidated item", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174400", "A");
    const itemB = sampleNote("123e4567-e89b-12d3-a456-426614174401", "B");
    const consolidated = sampleNote("123e4567-e89b-12d3-a456-426614174499", "C");

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [itemA, itemB] }));

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    await core.memoryStore.list();

    ws.emit("memory.item.consolidated", {
      payload: {
        from_memory_item_ids: [itemA.memory_item_id, itemB.memory_item_id],
        item: consolidated,
      },
    });

    expect(core.memoryStore.getSnapshot().browse.results).toEqual({
      kind: "list",
      items: [consolidated],
      nextCursor: null,
    });
  });

  it("does not duplicate consolidated items in list results", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174500", "A");
    const itemB = sampleNote("123e4567-e89b-12d3-a456-426614174501", "B");
    const consolidated = sampleNote("123e4567-e89b-12d3-a456-426614174599", "C");

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [itemA, consolidated, itemB] }));

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    await core.memoryStore.list();

    ws.emit("memory.item.consolidated", {
      payload: {
        from_memory_item_ids: [itemA.memory_item_id, itemB.memory_item_id],
        item: consolidated,
      },
    });

    expect(core.memoryStore.getSnapshot().browse.results).toEqual({
      kind: "list",
      items: [consolidated],
      nextCursor: null,
    });
  });

  it("inserts the consolidated item at the first from-id position when it already exists earlier", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const consolidated = sampleNote("123e4567-e89b-12d3-a456-426614174699", "old");
    const consolidatedUpdated: MemoryItem = {
      ...consolidated,
      body_md: "new",
      updated_at: "2026-02-19T12:00:02Z",
    };

    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174700", "A");
    const itemB = sampleNote("123e4567-e89b-12d3-a456-426614174701", "B");
    const itemAfter = sampleNote("123e4567-e89b-12d3-a456-426614174702", "after");

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [consolidated, itemA, itemB, itemAfter] }));

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    await core.memoryStore.list();

    ws.emit("memory.item.consolidated", {
      payload: {
        from_memory_item_ids: [itemA.memory_item_id, itemB.memory_item_id],
        item: consolidatedUpdated,
      },
    });

    expect(core.memoryStore.getSnapshot().browse.results).toEqual({
      kind: "list",
      items: [consolidatedUpdated, itemAfter],
      nextCursor: null,
    });
  });

  it("updates an inspected consolidated item when a consolidation event upserts it", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174520", "A");
    const itemB = sampleNote("123e4567-e89b-12d3-a456-426614174521", "B");
    const consolidated = sampleNote("123e4567-e89b-12d3-a456-426614174599", "old");
    const consolidatedUpdated: MemoryItem = {
      ...consolidated,
      body_md: "new",
      updated_at: "2026-02-19T12:00:02Z",
    };

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [itemA, consolidated, itemB] }));
    ws.memoryGet = vi.fn(async () => ({ v: 1, item: consolidated }) as unknown);

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    await core.memoryStore.list();
    await core.memoryStore.inspect(consolidated.memory_item_id);

    ws.emit("memory.item.consolidated", {
      payload: {
        from_memory_item_ids: [itemA.memory_item_id, itemB.memory_item_id],
        item: consolidatedUpdated,
      },
    });

    expect(core.memoryStore.getSnapshot().inspect.item).toEqual(consolidatedUpdated);
  });

  it("forgets items and records tombstones", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const item = sampleNote("123e4567-e89b-12d3-a456-426614174200", "Forget me");
    const tombstone = sampleTombstone(item.memory_item_id);

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item] }));
    ws.memoryForget = vi.fn(async () => ({ v: 1, deleted_count: 1, tombstones: [tombstone] }));

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    await core.memoryStore.list();
    await core.memoryStore.inspect(item.memory_item_id);

    await core.memoryStore.forget([{ kind: "id", memory_item_id: item.memory_item_id }]);

    expect(ws.memoryForget).toHaveBeenCalledWith({
      v: 1,
      confirm: "FORGET",
      selectors: [{ kind: "id", memory_item_id: item.memory_item_id }],
    });
    expect(core.memoryStore.getSnapshot().tombstones.tombstones).toEqual([tombstone]);
    expect(core.memoryStore.getSnapshot().browse.results).toEqual({
      kind: "list",
      items: [],
      nextCursor: null,
    });
    expect(core.memoryStore.getSnapshot().inspect.item).toBe(null);
  });

  it("exports memory and stores artifact id", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    const exportP = deferred<{ v: 1; artifact_id: string }>();
    ws.memoryExport = vi.fn(async () => await exportP.promise);

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    const pending = core.memoryStore.export({ includeTombstones: true });
    expect(core.memoryStore.getSnapshot().export.running).toBe(true);

    exportP.resolve({ v: 1, artifact_id: "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e" });
    await pending;

    expect(ws.memoryExport).toHaveBeenCalledWith({
      v: 1,
      filter: undefined,
      include_tombstones: true,
    });
    expect(core.memoryStore.getSnapshot().export.running).toBe(false);
    expect(core.memoryStore.getSnapshot().export.artifactId).toBe(
      "0a9d6b69-8bdb-4b1b-9d0b-9c8a0efc0d9e",
    );
  });

  it("clears export errors when a completion event arrives", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    ws.memoryExport = vi.fn(async () => {
      throw new Error("memory.export failed: unexpected: nope");
    });

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    await core.memoryStore.export();
    expect(core.memoryStore.getSnapshot().export.error).not.toBe(null);

    ws.emit("memory.export.completed", { payload: { artifact_id: "artifact-2" } });

    expect(core.memoryStore.getSnapshot().export.error).toBe(null);
    expect(core.memoryStore.getSnapshot().export.artifactId).toBe("artifact-2");
  });

  it("normalizes WS errors into a consistent error model", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    ws.memoryList = vi.fn(async () => {
      throw new Error("memory.list failed: unauthorized: nope");
    });

    const core = createOperatorCore({
      wsUrl: "ws://127.0.0.1:8788/ws",
      httpBaseUrl: "http://127.0.0.1:8788",
      auth: createBearerTokenAuth("test-token"),
      deps: { ws, http },
    });

    await core.memoryStore.list();

    expect(core.memoryStore.getSnapshot().browse.error).toEqual({
      kind: "ws",
      operation: "memory.list",
      code: "unauthorized",
      message: "nope",
    });
  });
});
