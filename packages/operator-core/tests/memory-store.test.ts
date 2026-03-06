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
  it("omits agent_id when memory operations use the implicit default scope", async () => {
    const ws = {
      memoryList: vi.fn(async () => ({
        v: 1,
        items: [{ memory_item_id: "m1" }],
        next_cursor: undefined,
      })),
      memorySearch: vi.fn(async () => ({
        v: 1,
        hits: [{ memory_item_id: "m1" }],
        next_cursor: undefined,
      })),
      memoryGet: vi.fn(async () => ({ v: 1, item: { memory_item_id: "m1" } })),
      memoryUpdate: vi.fn(async () => ({ v: 1, item: { memory_item_id: "m1" } })),
      memoryForget: vi.fn(async () => ({ v: 1, deleted_count: 1, tombstones: [] })),
      memoryExport: vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" })),
    } as any;

    const { store } = createMemoryStore(ws);

    await store.list();
    await store.search({ query: "remember" });
    await store.inspect("m1");
    await store.update("m1", { body_md: "updated" } as any);
    await store.forget([{ kind: "id", memory_item_id: "m1" }]);
    await store.export();

    expect(ws.memoryList).toHaveBeenCalledWith({
      v: 1,
      agent_id: undefined,
      filter: undefined,
      limit: undefined,
      cursor: undefined,
    });
    expect(ws.memorySearch).toHaveBeenCalledWith({
      v: 1,
      agent_id: undefined,
      query: "remember",
      filter: undefined,
      limit: undefined,
      cursor: undefined,
    });
    expect(ws.memoryGet).toHaveBeenCalledWith({
      v: 1,
      agent_id: undefined,
      memory_item_id: "m1",
    });
    expect(ws.memoryUpdate).toHaveBeenCalledWith({
      v: 1,
      agent_id: undefined,
      memory_item_id: "m1",
      patch: { body_md: "updated" },
    });
    expect(ws.memoryForget).toHaveBeenCalledWith({
      v: 1,
      agent_id: undefined,
      confirm: "FORGET",
      selectors: [{ kind: "id", memory_item_id: "m1" }],
    });
    expect(ws.memoryExport).toHaveBeenCalledWith({
      v: 1,
      agent_id: undefined,
      filter: undefined,
      include_tombstones: false,
    });
  });

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

  it("refreshBrowse() and loadMore() preserve an explicit agent scope", async () => {
    const ws = {
      memoryList: vi
        .fn()
        .mockResolvedValueOnce({
          v: 1,
          items: [{ memory_item_id: "m1", agent_id: "agent-2" }],
          next_cursor: "cursor-1",
        })
        .mockResolvedValueOnce({
          v: 1,
          items: [{ memory_item_id: "m2", agent_id: "agent-2" }],
          next_cursor: "cursor-2",
        })
        .mockResolvedValueOnce({
          v: 1,
          items: [{ memory_item_id: "m3", agent_id: "agent-2" }],
          next_cursor: undefined,
        }),
      memorySearch: vi.fn(async () => ({
        v: 1,
        hits: [],
        next_cursor: undefined,
      })),
      memoryGet: vi.fn(async () => ({ v: 1, item: {} })),
      memoryUpdate: vi.fn(async () => ({ v: 1, item: {} })),
      memoryForget: vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] })),
      memoryExport: vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" })),
    } as any;

    const { store } = createMemoryStore(ws);

    await store.list({ agentId: "agent-2" });
    await store.refreshBrowse();
    await store.loadMore();

    expect(ws.memoryList).toHaveBeenNthCalledWith(1, {
      v: 1,
      agent_id: "agent-2",
      filter: undefined,
      limit: undefined,
      cursor: undefined,
    });
    expect(ws.memoryList).toHaveBeenNthCalledWith(2, {
      v: 1,
      agent_id: "agent-2",
      filter: undefined,
      limit: undefined,
      cursor: undefined,
    });
    expect(ws.memoryList).toHaveBeenNthCalledWith(3, {
      v: 1,
      agent_id: "agent-2",
      filter: undefined,
      limit: undefined,
      cursor: "cursor-2",
    });
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

    handleMemoryItemUpsert({
      memory_item_id: "upsert-me",
      agent_id: "default",
      content: "new",
    } as any);
    handleMemoryTombstone({ memory_item_id: "delete-me", agent_id: "default" } as any);
    handleMemoryConsolidated(["from-1"], {
      memory_item_id: "consolidated",
      agent_id: "default",
      content: "c",
    } as any);

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
      agent_id: "default",
      content: "already-present",
    } as any);
    handleMemoryConsolidated(["fromB"], {
      memory_item_id: "consolidatedB",
      agent_id: "default",
      content: "cb",
    } as any);
    handleMemoryItemUpsert({
      memory_item_id: "new1",
      agent_id: "default",
      content: "new1-upserted",
    } as any);
    handleMemoryTombstone({ memory_item_id: "keep2", agent_id: "default" } as any);

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

    handleMemoryConsolidated(["from"], {
      memory_item_id: "consolidated",
      agent_id: "default",
    } as any);
    handleMemoryTombstone({ memory_item_id: "h1", agent_id: "default" } as any);

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

    handleMemoryTombstone({ memory_item_id: "m1", agent_id: "default" } as any);
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
      memoryUpdate: vi.fn(async () => ({
        v: 1,
        item: { memory_item_id: "m1", agent_id: "default", content: "new" },
      })),
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

  it("forwards agent scope through memory operations and ignores events from other agents", async () => {
    const scopedAgentId = "11111111-1111-4111-8111-111111111111";
    const ws = {
      memoryList: vi.fn(async () => ({
        v: 1,
        items: [{ memory_item_id: "m1", agent_id: scopedAgentId, content: "old" }],
        next_cursor: undefined,
      })),
      memorySearch: vi.fn(async () => ({
        v: 1,
        hits: [{ memory_item_id: "m1" }],
        next_cursor: undefined,
      })),
      memoryGet: vi.fn(async () => ({
        v: 1,
        item: { memory_item_id: "m1", agent_id: scopedAgentId, content: "old" },
      })),
      memoryUpdate: vi.fn(async () => ({
        v: 1,
        item: { memory_item_id: "m1", agent_id: scopedAgentId, content: "new" },
      })),
      memoryForget: vi.fn(async () => ({ v: 1, deleted_count: 1, tombstones: [] })),
      memoryExport: vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" })),
    } as any;

    const { store, handleMemoryItemUpsert } = createMemoryStore(ws);

    await store.list({ agentId: scopedAgentId });
    await store.search({ agentId: scopedAgentId, query: "old" });
    await store.inspect("m1", { agentId: scopedAgentId });
    await store.update("m1", { content: "new" } as any, { agentId: scopedAgentId });
    await store.forget([{ kind: "id", memory_item_id: "m1" }], { agentId: scopedAgentId });
    await store.export({ agentId: scopedAgentId });

    expect(ws.memoryList).toHaveBeenCalledWith({
      v: 1,
      agent_id: scopedAgentId,
      filter: undefined,
      limit: undefined,
      cursor: undefined,
    });
    expect(ws.memorySearch).toHaveBeenCalledWith({
      v: 1,
      agent_id: scopedAgentId,
      query: "old",
      filter: undefined,
      limit: undefined,
      cursor: undefined,
    });
    expect(ws.memoryGet).toHaveBeenCalledWith({
      v: 1,
      agent_id: scopedAgentId,
      memory_item_id: "m1",
    });
    expect(ws.memoryUpdate).toHaveBeenCalledWith({
      v: 1,
      agent_id: scopedAgentId,
      memory_item_id: "m1",
      patch: { content: "new" },
    });
    expect(ws.memoryForget).toHaveBeenCalledWith({
      v: 1,
      agent_id: scopedAgentId,
      confirm: "FORGET",
      selectors: [{ kind: "id", memory_item_id: "m1" }],
    });
    expect(ws.memoryExport).toHaveBeenCalledWith({
      v: 1,
      agent_id: scopedAgentId,
      filter: undefined,
      include_tombstones: false,
    });

    handleMemoryItemUpsert({
      memory_item_id: "m1",
      agent_id: "default",
      content: "ignored",
    } as any);
    expect((store.getSnapshot().inspect.item as any)?.content).toBe("new");
  });

  it("does not drop matching inspect events before a scoped agent UUID is learned", async () => {
    const resolvedAgentId = "33333333-3333-4333-8333-333333333333";
    const nextGet = deferred<any>();
    const ws = {
      memoryList: vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined })),
      memorySearch: vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined })),
      memoryGet: vi.fn(async () => nextGet.promise),
      memoryUpdate: vi.fn(async () => ({ v: 1, item: {} })),
      memoryForget: vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] })),
      memoryExport: vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" })),
    } as any;

    const { store, handleMemoryItemUpsert, handleMemoryTombstone } = createMemoryStore(ws);

    await store.list({ agentId: "agent-2" });

    const inspectPromise = store.inspect("m1", { agentId: "agent-2" });
    expect(store.getSnapshot().inspect.memoryItemId).toBe("m1");

    handleMemoryItemUpsert({
      memory_item_id: "m1",
      agent_id: resolvedAgentId,
      content: "event-update",
    } as any);
    expect((store.getSnapshot().inspect.item as any)?.content).toBe("event-update");

    handleMemoryTombstone({ memory_item_id: "m1", agent_id: resolvedAgentId } as any);
    expect(store.getSnapshot().inspect.memoryItemId).toBe(null);

    nextGet.resolve({
      v: 1,
      item: { memory_item_id: "m1", agent_id: resolvedAgentId, content: "late-response" },
    });
    await inspectPromise;

    expect(store.getSnapshot().inspect.memoryItemId).toBe(null);
    expect(store.getSnapshot().inspect.item).toBe(null);
  });
});
