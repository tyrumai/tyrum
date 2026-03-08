import { describe, expect, it, vi } from "vitest";
import { createWorkboardStore } from "../src/stores/workboard-store.js";

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

describe("workboard-store", () => {
  it("refreshList buffers work item upserts during an in-flight refresh", async () => {
    const nextList = deferred<any>();
    const ws = {
      workList: vi.fn(async () => nextList.promise),
    } as any;

    const { store, handleWorkItemUpsert } = createWorkboardStore(ws);

    const refreshPromise = store.refreshList();
    expect(store.getSnapshot().loading).toBe(true);

    handleWorkItemUpsert({ work_item_id: "w-buffered", status: "ready" } as any);

    nextList.resolve({
      items: [{ work_item_id: "w1", status: "backlog" }],
    });

    await refreshPromise;

    const snapshot = store.getSnapshot();
    expect(ws.workList).toHaveBeenCalledWith({
      agent_key: "default",
      workspace_key: "default",
      limit: 200,
    });
    expect(snapshot.supported).toBe(true);
    expect(snapshot.loading).toBe(false);
    expect(snapshot.error).toBe(null);
    expect(snapshot.lastSyncedAt).toEqual(expect.any(String));
    expect(snapshot.items.map((item) => item.work_item_id)).toEqual(["w-buffered", "w1"]);
  });

  it("marks WorkBoard as unsupported on the gateway unsupported_request error", async () => {
    const ws = {
      workList: vi.fn(async () => {
        throw new Error("work.list failed: unsupported_request");
      }),
    } as any;

    const { store } = createWorkboardStore(ws);

    await store.refreshList();

    const snapshot = store.getSnapshot();
    expect(snapshot.supported).toBe(false);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.loading).toBe(false);
    expect(snapshot.error).toBe(
      "WorkBoard is not supported by this gateway (database not configured).",
    );

    store.resetSupportProbe();
    expect(store.getSnapshot().supported).toBe(null);
    expect(store.getSnapshot().error).toBe(null);
  });

  it("surfaces unexpected errors and keeps the supported probe unset", async () => {
    const ws = {
      workList: vi.fn(async () => {
        throw new Error("boom");
      }),
    } as any;

    const { store } = createWorkboardStore(ws);
    await store.refreshList();

    const snapshot = store.getSnapshot();
    expect(snapshot.supported).toBe(null);
    expect(snapshot.loading).toBe(false);
    expect(snapshot.error).toBe("boom");
  });

  it("ignores refresh results when a newer refresh starts", async () => {
    const a = deferred<any>();
    const b = deferred<any>();
    const ws = {
      workList: vi
        .fn()
        .mockImplementationOnce(async () => a.promise)
        .mockImplementationOnce(async () => b.promise),
    } as any;

    const { store } = createWorkboardStore(ws);

    const p1 = store.refreshList();
    const p2 = store.refreshList();

    b.resolve({ items: [{ work_item_id: "new", status: "ready" }] });
    await p2;

    a.resolve({ items: [{ work_item_id: "old", status: "ready" }] });
    await p1;

    expect(store.getSnapshot().items.map((item) => item.work_item_id)).toEqual(["new"]);
  });
});
