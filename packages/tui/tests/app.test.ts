import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "ink";
import { TuiApp } from "../src/app.js";
import {
  createTestStreams,
  sleep,
  normalizeTuiOutput,
  waitFor,
  createMemorySnapshot,
  DEFAULT_MEMORY_ITEM,
  createMemoryStore,
  openMemory,
  DEFAULT_CONFIG,
  createEmptyApprovalsStore,
  createPairingStore,
  createElevatedModeStore,
  createConnectionStore,
  createCore,
  createRuntime,
} from "./app.test-helpers.js";

function renderTuiApp(core: unknown) {
  const runtime = createRuntime(core);
  const io = createTestStreams();
  const instance = render(React.createElement(TuiApp, { runtime, config: DEFAULT_CONFIG }), {
    stdout: io.stdout,
    stdin: io.stdin,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { io, instance };
}

describe("TuiApp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders routes and opens Elevated Mode dialog", async () => {
    const connect = vi.fn();
    const disconnect = vi.fn();
    const core = createCore({
      connect,
      disconnect,
      elevatedModeStore: createElevatedModeStore("inactive"),
      connectionStore: createConnectionStore("disconnected"),
      approvalsStore: createEmptyApprovalsStore({
        pendingIds: [1],
        byId: {
          1: {
            approval_id: 1,
            status: "pending",
            kind: "tool",
            prompt: "Approve?",
            created_at: "2026-02-26T00:00:00.000Z",
          },
        },
      }),
      pairingStore: createPairingStore({
        byId: {
          10: {
            pairing_id: 10,
            status: "pending",
            node: { node_id: "node-1", label: null, capabilities: [] },
            capability_allowlist: [],
            trust_level: null,
            created_at: "2026-02-26T00:00:00.000Z",
            updated_at: "2026-02-26T00:00:00.000Z",
          },
          11: {
            pairing_id: 11,
            status: "approved",
            node: { node_id: "node-2", label: "Node 2", capabilities: [] },
            capability_allowlist: [],
            trust_level: "local",
            created_at: "2026-02-26T00:00:00.000Z",
            updated_at: "2026-02-26T00:00:00.000Z",
          },
        },
        pendingIds: [10],
      }),
      memoryStore: createMemoryStore(),
    });
    const { io, instance } = renderTuiApp(core);

    try {
      await waitFor(() => connect.mock.calls.length === 1);

      io.stdin.write("2");
      await sleep(25);
      io.stdin.write("3");
      await sleep(25);
      io.stdin.write("5");
      await sleep(25);
      io.stdin.write("4");
      await sleep(25);

      io.stdin.write("d");
      await waitFor(() => disconnect.mock.calls.length === 1);

      io.stdin.write("c");
      await waitFor(() => connect.mock.calls.length === 2);

      io.stdin.write("m");
      await sleep(25);

      io.stdin.write("c");
      await sleep(25);
      expect(connect).toHaveBeenCalledTimes(2);

      io.stdin.write("\u001b");
      // Allow Ink's terminal input parser to flush the Escape key before the next shortcut.
      await sleep(150);

      io.stdin.write("c");
      await waitFor(() => connect.mock.calls.length === 3);
    } finally {
      instance.unmount();
      await waitFor(() => disconnect.mock.calls.length === 2);
      expect(disconnect).toHaveBeenCalledTimes(2);
    }
  }, 20_000);

  it("drives Memory route search/forget/export flows", async () => {
    const connect = vi.fn();
    const disconnect = vi.fn();
    let exportCatchAttached = false;
    const exportCatchTracker = {
      catch(_onRejected: (reason: unknown) => unknown) {
        exportCatchAttached = true;
        return exportCatchTracker;
      },
    } as unknown as Promise<never>;

    const memoryStore = createMemoryStore(
      createMemorySnapshot({
        browse: {
          request: { kind: "list", filter: undefined, limit: undefined },
          results: { kind: "list", items: [DEFAULT_MEMORY_ITEM], nextCursor: null },
        },
      }),
      { export: vi.fn(() => exportCatchTracker) },
    );

    const core = createCore({
      connect,
      disconnect,
      elevatedModeStore: createElevatedModeStore("active"),
      connectionStore: createConnectionStore("connected"),
      memoryStore,
    });
    const { io, instance } = renderTuiApp(core);

    try {
      await waitFor(() => connect.mock.calls.length === 1);
      await openMemory(io, memoryStore);

      io.stdin.write("r");
      await waitFor(() => memoryStore.list.mock.calls.length === 1);
      memoryStore.list.mockClear();

      io.stdin.write("/");
      await sleep(25);
      io.stdin.write("abc");
      await sleep(25);
      io.stdin.write("\r");
      await waitFor(() => memoryStore.search.mock.calls.length === 1);
      expect(memoryStore.search).toHaveBeenCalledWith({ query: "abc" });

      io.stdin.write("f");
      await sleep(25);
      io.stdin.write("FORGET");
      await sleep(25);
      io.stdin.write("\r");
      await waitFor(() => memoryStore.forget.mock.calls.length === 1);
      expect(memoryStore.forget).toHaveBeenCalledWith([
        { kind: "id", memory_item_id: DEFAULT_MEMORY_ITEM.memory_item_id },
      ]);

      io.stdin.write("p");
      await waitFor(() => memoryStore.export.mock.calls.length === 1);
      expect(exportCatchAttached).toBe(true);
    } finally {
      instance.unmount();
      await waitFor(() => disconnect.mock.calls.length === 1);
    }
  }, 20_000);

  it("keeps Memory forget dialog open when the store reports an error", async () => {
    const connect = vi.fn();
    const disconnect = vi.fn();
    let finalOutput = "";

    let memorySnapshot = createMemorySnapshot({
      browse: {
        request: { kind: "list", filter: undefined, limit: undefined },
        results: { kind: "list", items: [DEFAULT_MEMORY_ITEM], nextCursor: null },
      },
    });

    const memoryStore = {
      subscribe: () => () => {},
      getSnapshot: () => memorySnapshot,
      list: vi.fn(async () => {}),
      search: vi.fn(async () => {}),
      loadMore: vi.fn(async () => {}),
      inspect: vi.fn(async () => {}),
      forget: vi.fn(async () => {
        memorySnapshot = createMemorySnapshot({
          browse: memorySnapshot.browse,
          inspect: memorySnapshot.inspect,
          export: memorySnapshot.export,
          tombstones: {
            ...memorySnapshot.tombstones,
            loading: false,
            error: {
              kind: "ws",
              operation: "memory.forget",
              code: "forbidden",
              message: "nope",
            },
          },
        });
      }),
      export: vi.fn(async () => {}),
    };

    const core = createCore({
      connect,
      disconnect,
      elevatedModeStore: createElevatedModeStore("active"),
      connectionStore: createConnectionStore("connected"),
      memoryStore,
    });
    const { io, instance } = renderTuiApp(core);

    try {
      await waitFor(() => connect.mock.calls.length === 1);
      await openMemory(io, memoryStore);

      io.stdin.write("f");
      await sleep(25);
      io.stdin.write("FORGET");
      await sleep(25);
      io.stdin.write("\r");

      await waitFor(() => memoryStore.forget.mock.calls.length === 1);

      io.stdin.write("p");
      await sleep(50);
      expect(memoryStore.export).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
      await waitFor(() => disconnect.mock.calls.length === 1);
      finalOutput = normalizeTuiOutput(io.readOutput());
    }

    expect(finalOutput).toContain("Forget error: nope");
  }, 20_000);

  it("treats an empty Memory search query as list", async () => {
    const connect = vi.fn();
    const disconnect = vi.fn();

    const memoryStore = createMemoryStore();

    const core = createCore({
      connect,
      disconnect,
      elevatedModeStore: createElevatedModeStore("inactive"),
      connectionStore: createConnectionStore("connected"),
      memoryStore,
    });
    const { io, instance } = renderTuiApp(core);

    try {
      await waitFor(() => connect.mock.calls.length === 1);
      await openMemory(io, memoryStore);

      io.stdin.write("/");
      await sleep(25);
      io.stdin.write("\r");

      await waitFor(() => memoryStore.list.mock.calls.length === 1);
      expect(memoryStore.search).not.toHaveBeenCalled();
    } finally {
      instance.unmount();
      await waitFor(() => disconnect.mock.calls.length === 1);
    }
  }, 20_000);
});
