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
      scope: {
        tenant_id: "tenant-1",
        agent_id: "agent-1",
        workspace_id: "workspace-1",
      },
      items: [{ work_item_id: "w1", status: "backlog" }],
    });

    await refreshPromise;

    const snapshot = store.getSnapshot();
    expect(ws.workList).toHaveBeenCalledWith({
      agent_key: "default",
      workspace_key: "default",
      limit: 200,
    });
    expect(snapshot.scopeKeys).toEqual({
      agent_key: "default",
      workspace_key: "default",
    });
    expect(snapshot.resolvedScope).toEqual({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "workspace-1",
    });
    expect(snapshot.supported).toBe(true);
    expect(snapshot.loading).toBe(false);
    expect(snapshot.error).toBe(null);
    expect(snapshot.lastSyncedAt).toEqual(expect.any(String));
    expect(snapshot.items.map((item) => item.work_item_id)).toEqual(["w-buffered", "w1"]);
  });

  it("uses updated scope keys after a scope change", async () => {
    const ws = {
      workList: vi.fn(async () => ({
        scope: {
          tenant_id: "tenant-1",
          agent_id: "agent-planner",
          workspace_id: "workspace-ops",
        },
        items: [],
      })),
    } as any;

    const { store } = createWorkboardStore(ws);
    store.setScopeKeys({ agent_key: "planner", workspace_key: "ops" });

    const scopedSnapshot = store.getSnapshot();
    expect(scopedSnapshot.scopeKeys).toEqual({
      agent_key: "planner",
      workspace_key: "ops",
    });
    expect(scopedSnapshot.items).toEqual([]);

    await store.refreshList();

    expect(ws.workList).toHaveBeenCalledWith({
      agent_key: "planner",
      workspace_key: "ops",
      limit: 200,
    });
    expect(store.getSnapshot().resolvedScope).toEqual({
      tenant_id: "tenant-1",
      agent_id: "agent-planner",
      workspace_id: "workspace-ops",
    });
  });

  it("marks WorkBoard as unsupported on the gateway unsupported_request error", async () => {
    const ws = {
      workList: vi
        .fn()
        .mockResolvedValueOnce({
          scope: {
            tenant_id: "tenant-1",
            agent_id: "agent-1",
            workspace_id: "workspace-1",
          },
          items: [{ work_item_id: "w1", status: "ready" }],
        })
        .mockRejectedValueOnce(new Error("work.list failed: unsupported_request")),
    } as any;

    const { store } = createWorkboardStore(ws);

    await store.refreshList();
    expect(store.getSnapshot().resolvedScope).toEqual({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "workspace-1",
    });

    await store.refreshList();

    const snapshot = store.getSnapshot();
    expect(snapshot.supported).toBe(false);
    expect(snapshot.items).toEqual([]);
    expect(snapshot.loading).toBe(false);
    expect(snapshot.error).toBe(
      "WorkBoard is not supported by this gateway (database not configured).",
    );
    expect(snapshot.resolvedScope).toBe(null);

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
    expect(snapshot.resolvedScope).toBe(null);
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

    b.resolve({
      scope: {
        tenant_id: "tenant-1",
        agent_id: "agent-new",
        workspace_id: "workspace-new",
      },
      items: [{ work_item_id: "new", status: "ready" }],
    });
    await p2;

    a.resolve({
      scope: {
        tenant_id: "tenant-1",
        agent_id: "agent-old",
        workspace_id: "workspace-old",
      },
      items: [{ work_item_id: "old", status: "ready" }],
    });
    await p1;

    expect(store.getSnapshot().items.map((item) => item.work_item_id)).toEqual(["new"]);
    expect(store.getSnapshot().resolvedScope).toEqual({
      tenant_id: "tenant-1",
      agent_id: "agent-new",
      workspace_id: "workspace-new",
    });
  });

  it("removes work items and their task cache entries", () => {
    const ws = {
      workList: vi.fn(async () => ({ items: [] })),
    } as any;

    const { store, handleWorkTaskEvent } = createWorkboardStore(ws);
    store.upsertWorkItem({ work_item_id: "work-1", status: "ready" } as any);
    store.upsertWorkItem({ work_item_id: "work-2", status: "blocked" } as any);
    handleWorkTaskEvent({
      type: "work.task.paused",
      occurred_at: "2026-01-01T00:00:00.000Z",
      payload: {
        work_item_id: "work-1",
        task_id: "task-1",
      },
    });

    store.removeWorkItem("work-1");

    const snapshot = store.getSnapshot();
    expect(snapshot.items.map((item) => item.work_item_id)).toEqual(["work-2"]);
    expect(snapshot.tasksByWorkItemId["work-1"]).toBeUndefined();
  });
});
