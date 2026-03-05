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
});
