import { describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "../src/stores/memory-store.js";

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

describe("memory-store", () => {
  it("refreshBrowse preserves existing results while loading", async () => {
    const ws = {
      memoryList: vi.fn(async () => ({
        v: 1,
        items: [{ memory_item_id: "memory-1" }],
        next_cursor: undefined,
      })),
      memorySearch: vi.fn(async () => ({
        v: 1,
        hits: [],
        next_cursor: undefined,
      })),
    } as any;

    const { store } = createMemoryStore(ws);

    await store.list();
    const before = store.getSnapshot().browse.results;
    expect(before).not.toBeNull();

    const nextList = deferred<unknown>();
    ws.memoryList.mockImplementationOnce(async () => nextList.promise);

    const refreshPromise = store.refreshBrowse();
    expect(store.getSnapshot().browse.loading).toBe(true);
    expect(store.getSnapshot().browse.results).toBe(before);

    nextList.resolve({
      v: 1,
      items: [{ memory_item_id: "memory-2" }],
      next_cursor: undefined,
    });
    await refreshPromise;

    expect(store.getSnapshot().browse.loading).toBe(false);
    expect((store.getSnapshot().browse.results as any)?.items?.[0]?.memory_item_id).toBe(
      "memory-2",
    );
  });

  it("buffers upserts, tombstones, and consolidations during list() and applies them on completion", async () => {
    const nextList = deferred<any>();
    const ws = {
      memoryList: vi.fn(async () => nextList.promise),
      memorySearch: vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined })),
      memoryGet: vi.fn(async () => ({ v: 1, item: {} })),
      memoryUpdate: vi.fn(async () => ({ v: 1, item: {} })),
      memoryForget: vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] })),
      memoryExport: vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" })),
    } as any;

    const { store, handleMemoryItemUpsert, handleMemoryTombstone, handleMemoryConsolidated } =
      createMemoryStore(ws);

    const listPromise = store.list();
    expect(store.getSnapshot().browse.loading).toBe(true);

    handleMemoryItemUpsert({ memory_item_id: "upsert-me", content: "new" } as any);
    handleMemoryTombstone({ memory_item_id: "delete-me" } as any);
    handleMemoryConsolidated(["from-1"], { memory_item_id: "consolidated", content: "c" } as any);

    nextList.resolve({
      v: 1,
      items: [
        { memory_item_id: "from-1", content: "from" },
        { memory_item_id: "keep", content: "keep" },
        { memory_item_id: "delete-me", content: "gone" },
        { memory_item_id: "upsert-me", content: "old" },
      ],
      next_cursor: undefined,
    });

    await listPromise;

    const results = store.getSnapshot().browse.results as any;
    expect(results.kind).toBe("list");
    expect(results.items.map((item: any) => item.memory_item_id)).toEqual([
      "consolidated",
      "keep",
      "upsert-me",
    ]);
    expect(results.items.find((item: any) => item.memory_item_id === "upsert-me")?.content).toBe(
      "new",
    );
    expect(store.getSnapshot().tombstones.tombstones.map((t: any) => t.memory_item_id)).toEqual([
      "delete-me",
    ]);
  });

  it("loadMore() merges list pages, drops redundant consolidations, and applies buffered deletes/upserts", async () => {
    const ws = {
      memoryList: vi
        .fn()
        .mockResolvedValueOnce({
          v: 1,
          items: [
            { memory_item_id: "consolidated", content: "c1" },
            { memory_item_id: "keep1", content: "k1" },
            { memory_item_id: "fromB", content: "fromB" },
            { memory_item_id: "keep2", content: "k2" },
          ],
          next_cursor: "cursor-1",
        })
        .mockImplementationOnce(async () => nextPage.promise),
      memorySearch: vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined })),
      memoryGet: vi.fn(async () => ({ v: 1, item: {} })),
      memoryUpdate: vi.fn(async () => ({ v: 1, item: {} })),
      memoryForget: vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] })),
      memoryExport: vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" })),
    } as any;

    const nextPage = deferred<any>();
    const { store, handleMemoryConsolidated, handleMemoryItemUpsert, handleMemoryTombstone } =
      createMemoryStore(ws);

    await store.list();
    expect(store.getSnapshot().browse.results?.kind).toBe("list");
    expect(store.getSnapshot().browse.results?.nextCursor).toBe("cursor-1");

    const loadMorePromise = store.loadMore();

    handleMemoryConsolidated(["fromA"], {
      memory_item_id: "consolidated",
      content: "already-present",
    } as any);
    handleMemoryConsolidated(["fromB"], { memory_item_id: "consolidatedB", content: "cb" } as any);
    handleMemoryItemUpsert({ memory_item_id: "new1", content: "new1-upserted" } as any);
    handleMemoryTombstone({ memory_item_id: "keep2" } as any);

    nextPage.resolve({
      v: 1,
      items: [
        { memory_item_id: "fromA", content: "fromA" },
        { memory_item_id: "consolidated", content: "dup" },
        { memory_item_id: "new1", content: "new1-original" },
      ],
      next_cursor: undefined,
    });

    await loadMorePromise;

    const results = store.getSnapshot().browse.results as any;
    expect(results.kind).toBe("list");
    expect(results.items.map((item: any) => item.memory_item_id)).toEqual([
      "consolidated",
      "keep1",
      "consolidatedB",
      "new1",
    ]);
    expect(results.items.find((item: any) => item.memory_item_id === "new1")?.content).toBe(
      "new1-upserted",
    );
  });

  it("loadMore() merges search pages and filters consolidated/tombstoned hits", async () => {
    const ws = {
      memoryList: vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined })),
      memorySearch: vi
        .fn()
        .mockResolvedValueOnce({
          v: 1,
          hits: [{ memory_item_id: "h1" }, { memory_item_id: "from" }],
          next_cursor: "cursor-1",
        })
        .mockImplementationOnce(async () => nextPage.promise),
      memoryGet: vi.fn(async () => ({ v: 1, item: {} })),
      memoryUpdate: vi.fn(async () => ({ v: 1, item: {} })),
      memoryForget: vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] })),
      memoryExport: vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" })),
    } as any;

    const nextPage = deferred<any>();
    const { store, handleMemoryConsolidated, handleMemoryTombstone } = createMemoryStore(ws);

    await store.search({ query: "q" });
    expect(store.getSnapshot().browse.results?.kind).toBe("search");
    expect(store.getSnapshot().browse.results?.nextCursor).toBe("cursor-1");

    const loadMorePromise = store.loadMore();

    handleMemoryConsolidated(["from"], { memory_item_id: "consolidated" } as any);
    handleMemoryTombstone({ memory_item_id: "h1" } as any);

    nextPage.resolve({
      v: 1,
      hits: [{ memory_item_id: "h2" }, { memory_item_id: "from" }],
      next_cursor: undefined,
    });

    await loadMorePromise;

    const results = store.getSnapshot().browse.results as any;
    expect(results.kind).toBe("search");
    expect(results.hits.map((hit: any) => hit.memory_item_id)).toEqual(["h2"]);
  });

  it("inspect() uses browse results while loading and ignores responses after tombstone", async () => {
    const ws = {
      memoryList: vi.fn(async () => ({
        v: 1,
        items: [{ memory_item_id: "m1", content: "list-item" }],
        next_cursor: undefined,
      })),
      memorySearch: vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined })),
      memoryGet: vi.fn(async () => nextGet.promise),
      memoryUpdate: vi.fn(async () => ({ v: 1, item: {} })),
      memoryForget: vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] })),
      memoryExport: vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" })),
    } as any;

    const nextGet = deferred<any>();
    const { store, handleMemoryTombstone } = createMemoryStore(ws);

    await store.list();

    const inspectPromise = store.inspect("m1");
    expect(store.getSnapshot().inspect.loading).toBe(true);
    expect((store.getSnapshot().inspect.item as any)?.content).toBe("list-item");

    handleMemoryTombstone({ memory_item_id: "m1" } as any);
    expect(store.getSnapshot().inspect.memoryItemId).toBe(null);

    nextGet.resolve({ v: 1, item: { memory_item_id: "m1", content: "remote" } });
    await inspectPromise;

    expect(store.getSnapshot().inspect.memoryItemId).toBe(null);
    expect(store.getSnapshot().inspect.item).toBe(null);
  });

  it("update() upserts into browse results and inspect state", async () => {
    const ws = {
      memoryList: vi.fn(async () => ({
        v: 1,
        items: [{ memory_item_id: "m1", content: "old" }],
        next_cursor: undefined,
      })),
      memorySearch: vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined })),
      memoryGet: vi.fn(async () => ({ v: 1, item: { memory_item_id: "m1", content: "old" } })),
      memoryUpdate: vi.fn(async () => ({ v: 1, item: { memory_item_id: "m1", content: "new" } })),
      memoryForget: vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] })),
      memoryExport: vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" })),
    } as any;

    const { store } = createMemoryStore(ws);

    await store.list();
    await store.inspect("m1");

    await store.update("m1", { content: "new" } as any);

    const results = store.getSnapshot().browse.results as any;
    expect(results.items[0]?.content).toBe("new");
    expect((store.getSnapshot().inspect.item as any)?.content).toBe("new");
  });

  it("forget()/export() surface ws errors and handle export completion events", async () => {
    const ws = {
      memoryList: vi.fn(async () => ({
        v: 1,
        items: [{ memory_item_id: "m1" }, { memory_item_id: "m2" }],
        next_cursor: undefined,
      })),
      memorySearch: vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined })),
      memoryGet: vi.fn(async () => ({ v: 1, item: { memory_item_id: "m1" } })),
      memoryUpdate: vi.fn(async () => ({ v: 1, item: { memory_item_id: "m1" } })),
      memoryForget: vi.fn(async () => {
        throw new Error("nope");
      }),
      memoryExport: vi.fn(async () => {
        throw new Error("nope");
      }),
    } as any;

    const { store, handleMemoryExportCompleted } = createMemoryStore(ws);

    await store.list();
    await store.inspect("m1");

    await store.forget([{ kind: "memory_item_id", memory_item_id: "m2" }] as any);
    expect(store.getSnapshot().tombstones.error?.kind).toBe("ws");

    await store.export();
    expect(store.getSnapshot().export.error?.kind).toBe("ws");

    handleMemoryExportCompleted("artifact-123");
    expect(store.getSnapshot().export.artifactId).toBe("artifact-123");
    expect(store.getSnapshot().export.running).toBe(false);
  });
});
