import React from "react";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "ink";
import { TuiApp } from "../src/app.js";

function createTestStreams(): {
  stdout: PassThrough & { columns: number; rows: number };
  stdin: PassThrough & {
    isTTY: boolean;
    setRawMode: (enabled: boolean) => void;
    ref: () => void;
    unref: () => void;
    resume: () => PassThrough;
  };
  readOutput: () => string;
} {
  const stdout = new PassThrough() as PassThrough & {
    columns: number;
    rows: number;
    isTTY: boolean;
  };
  stdout.columns = 80;
  stdout.rows = 24;
  stdout.isTTY = true;
  let output = "";
  stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    output += text;
  });

  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (enabled: boolean) => void;
    ref: () => void;
    unref: () => void;
    resume: () => PassThrough;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  stdin.resume = () => stdin;

  return {
    stdout,
    stdin,
    readOutput: () => output,
  };
}

function createStore<T>(snapshot: T): { getSnapshot: () => T; subscribe: (listener: () => void) => () => void } {
  return { getSnapshot: () => snapshot, subscribe: () => () => {} };
}

async function sleep(ms: number): Promise<void> { await new Promise((resolve) => setTimeout(resolve, ms)); }

const ANSI_ESCAPE_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function normalizeTuiOutput(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, "").replace(/\r/g, "");
}

async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 2_000, intervalMs = 25 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(intervalMs);
  }

  throw new Error("Timed out waiting for condition");
}

function createMemorySnapshot(
  overrides: Partial<{
    browse: unknown;
    inspect: unknown;
    tombstones: unknown;
    export: unknown;
  }> = {},
): {
  browse: unknown;
  inspect: unknown;
  tombstones: unknown;
  export: unknown;
} {
  return {
    browse: {
      request: { kind: "list", filter: undefined, limit: undefined },
      results: { kind: "list", items: [], nextCursor: null },
      loading: false,
      error: null,
      lastSyncedAt: null,
      ...(overrides.browse as Record<string, unknown> | undefined),
    },
    inspect: {
      memoryItemId: null,
      item: null,
      loading: false,
      error: null,
      ...(overrides.inspect as Record<string, unknown> | undefined),
    },
    tombstones: {
      tombstones: [],
      loading: false,
      error: null,
      ...(overrides.tombstones as Record<string, unknown> | undefined),
    },
    export: {
      running: false,
      artifactId: null,
      error: null,
      lastExportedAt: null,
      ...(overrides.export as Record<string, unknown> | undefined),
    },
  };
}

const DEFAULT_MEMORY_ITEM = { v: 1, memory_item_id: "mem-1", agent_id: "agent-1", kind: "note", tags: [], sensitivity: "private", provenance: { source_kind: "operator", refs: [] }, created_at: "2026-02-26T00:00:00.000Z", body_md: "hello" } as const;

function createMemoryStore(snapshot = createMemorySnapshot(), overrides: Partial<Record<"list" | "search" | "loadMore" | "inspect" | "forget" | "export", unknown>> = {}) {
  return {
    ...createStore(snapshot),
    list: vi.fn(async () => {}),
    search: vi.fn(async (_input: { query: string }) => {}),
    loadMore: vi.fn(async () => {}),
    inspect: vi.fn(async (_memoryItemId: string) => {}),
    forget: vi.fn(async (_selectors: unknown[]) => {}),
    export: vi.fn(async () => {}),
    ...overrides,
  };
}

async function openMemory(io: ReturnType<typeof createTestStreams>, memoryStore: { list: ReturnType<typeof vi.fn> }) {
  io.stdin.write("6");
  await waitFor(() => memoryStore.list.mock.calls.length === 1);
  memoryStore.list.mockClear();
}

const DEFAULT_CONFIG = { httpBaseUrl: "http://127.0.0.1:8788", wsUrl: "ws://127.0.0.1:8788/ws", token: "token", deviceIdentityPath: "/tmp/device-identity.json", reconnect: false, tlsCertFingerprint256: undefined, tlsAllowSelfSigned: false } as const;

function createEmptyApprovalsStore(overrides: Partial<{ pendingIds: number[]; byId: Record<number, unknown> }> = {}) {
  return {
    ...createStore({
      pendingIds: [],
      byId: {},
      loading: false,
      error: null,
      ...overrides,
    }),
    refreshPending: vi.fn(async () => {}),
    resolve: vi.fn(async () => {}),
  };
}

function createPairingStore(overrides: Partial<{
  byId: Record<number, unknown>; pendingIds: number[]; loading: boolean; error: unknown; lastSyncedAt: string | null
}> = {}) {
  return {
    ...createStore({
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
      ...overrides,
    }),
    refresh: vi.fn(async () => {}),
    approve: vi.fn(async () => {}),
    deny: vi.fn(async () => {}),
    revoke: vi.fn(async () => {}),
  };
}

function createStatusStore() {
  return createStore({ status: null, usage: null, presenceByInstanceId: {}, loading: { status: false, usage: false, presence: false }, error: { status: null, usage: null, presence: null }, lastSyncedAt: null });
}

function createRunsStore() { return createStore({ runsById: {}, stepIdsByRunId: {}, stepsById: {}, attemptIdsByStepId: {}, attemptsById: {} }); }

function createElevatedModeStore(status: "active" | "inactive", overrides: Partial<{
  elevatedToken: string | null; enteredAt: string | null; expiresAt: string | null; remainingMs: number | null
}> = {}) {
  return createStore({
    status,
    elevatedToken: status === "active" ? "elevated" : null,
    enteredAt: status === "active" ? "2026-02-26T00:00:00.000Z" : null,
    expiresAt: status === "active" ? "2026-02-26T00:10:00.000Z" : null,
    remainingMs: status === "active" ? 60_000 : null,
    ...overrides,
  });
}

function createConnectionStore(status: "connected" | "disconnected", overrides: Partial<{
  clientId: string; transportError: string | null; lastDisconnect: { code: number; reason: string } | null
}> = {}) {
  return createStore({
    status,
    clientId: "client-1",
    transportError: status === "disconnected" ? "network down" : null,
    lastDisconnect: status === "disconnected" ? { code: 1006, reason: "closed" } : null,
    ...overrides,
  });
}

function createCore({ connect, disconnect, memoryStore, elevatedModeStore, connectionStore, approvalsStore = createEmptyApprovalsStore(), pairingStore = createPairingStore() }: {
  connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; memoryStore: unknown; elevatedModeStore: ReturnType<typeof createStore>; connectionStore: ReturnType<typeof createStore>; approvalsStore?: ReturnType<typeof createEmptyApprovalsStore>; pairingStore?: ReturnType<typeof createPairingStore>
}) {
  return {
    connect,
    disconnect,
    elevatedModeStore,
    connectionStore,
    approvalsStore,
    pairingStore,
    statusStore: createStatusStore(),
    runsStore: createRunsStore(),
    memoryStore,
  };
}

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

function createRuntime(core: unknown): {
  manager: { getCore: () => unknown; subscribe: () => () => void; dispose: () => void }; enterElevatedMode: (token: string) => Promise<void>; exitElevatedMode: () => void; dispose: () => void
} {
  const manager = { getCore: () => core, subscribe: () => () => {}, dispose: () => {} };
  return {
    manager,
    enterElevatedMode: vi.fn(async () => {}),
    exitElevatedMode: vi.fn(() => {}),
    dispose: vi.fn(() => {}),
  };
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
          1: { approval_id: 1, status: "pending", kind: "tool", prompt: "Approve?", created_at: "2026-02-26T00:00:00.000Z" },
        },
      }),
      pairingStore: createPairingStore({
        byId: {
          10: { pairing_id: 10, status: "pending", node: { node_id: "node-1", label: null, capabilities: [] }, capability_allowlist: [], trust_level: null, created_at: "2026-02-26T00:00:00.000Z", updated_at: "2026-02-26T00:00:00.000Z" },
          11: { pairing_id: 11, status: "approved", node: { node_id: "node-2", label: "Node 2", capabilities: [] }, capability_allowlist: [], trust_level: "local", created_at: "2026-02-26T00:00:00.000Z", updated_at: "2026-02-26T00:00:00.000Z" },
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
      await sleep(25);

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
