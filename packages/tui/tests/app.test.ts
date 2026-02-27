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
    output += chunk.toString("utf8");
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

function createStore<T>(snapshot: T): {
  getSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
} {
  return {
    getSnapshot() {
      return snapshot;
    },
    subscribe() {
      return () => {};
    },
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

const DEFAULT_CONFIG = {
  httpBaseUrl: "http://127.0.0.1:8788",
  wsUrl: "ws://127.0.0.1:8788/ws",
  token: "token",
  deviceIdentityPath: "/tmp/device-identity.json",
  reconnect: false,
  tlsCertFingerprint256: undefined,
} as const;

function createRuntime(core: unknown): {
  manager: { getCore: () => unknown; subscribe: () => () => void; dispose: () => void };
  enterAdminMode: (token: string) => Promise<void>;
  exitAdminMode: () => void;
  dispose: () => void;
} {
  const manager = {
    getCore: () => core,
    subscribe: () => () => {},
    dispose: () => {},
  };

  return {
    manager,
    enterAdminMode: vi.fn(async () => {}),
    exitAdminMode: vi.fn(() => {}),
    dispose: vi.fn(() => {}),
  };
}

describe("TuiApp", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders routes and opens Admin Mode dialog", async () => {
    const connect = vi.fn();
    const disconnect = vi.fn();
    const core = {
      connect,
      disconnect,
      adminModeStore: createStore({
        status: "inactive",
        elevatedToken: null,
        enteredAt: null,
        expiresAt: null,
        remainingMs: null,
      }),
      connectionStore: createStore({
        status: "disconnected",
        clientId: "client-1",
        transportError: "network down",
        lastDisconnect: { code: 1006, reason: "closed" },
      }),
      memoryStore: {
        ...createStore(createMemorySnapshot()),
        list: vi.fn(async () => {}),
        search: vi.fn(async () => {}),
        loadMore: vi.fn(async () => {}),
        inspect: vi.fn(async () => {}),
        forget: vi.fn(async () => {}),
        export: vi.fn(async () => {}),
      },
      approvalsStore: {
        ...createStore({
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
          loading: false,
          error: null,
        }),
        refreshPending: vi.fn(async () => {}),
        resolve: vi.fn(async () => {}),
      },
      pairingStore: {
        ...createStore({
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
          loading: false,
          error: null,
          lastSyncedAt: null,
        }),
        refresh: vi.fn(async () => {}),
        approve: vi.fn(async () => {}),
        deny: vi.fn(async () => {}),
        revoke: vi.fn(async () => {}),
      },
      statusStore: createStore({
        status: null,
        usage: null,
        presenceByInstanceId: {},
        loading: { status: false, usage: false, presence: false },
        error: { status: null, usage: null, presence: null },
        lastSyncedAt: null,
      }),
      runsStore: createStore({
        runsById: {},
        stepIdsByRunId: {},
        stepsById: {},
        attemptIdsByStepId: {},
        attemptsById: {},
      }),
    };

    const runtime = createRuntime(core);
    const config = DEFAULT_CONFIG;

    const io = createTestStreams();
    const instance = render(React.createElement(TuiApp, { runtime, config }), {
      stdout: io.stdout,
      stdin: io.stdin,
      exitOnCtrlC: false,
      patchConsole: false,
    });

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

    const item = {
      v: 1,
      memory_item_id: "mem-1",
      agent_id: "agent-1",
      kind: "note",
      tags: [],
      sensitivity: "private",
      provenance: { source_kind: "operator", refs: [] },
      created_at: "2026-02-26T00:00:00.000Z",
      body_md: "hello",
    } as const;

    const memoryStore = {
      ...createStore(
        createMemorySnapshot({
          browse: {
            request: { kind: "list", filter: undefined, limit: undefined },
            results: { kind: "list", items: [item], nextCursor: null },
          },
        }),
      ),
      list: vi.fn(async () => {}),
      search: vi.fn(async (_input: { query: string }) => {}),
      loadMore: vi.fn(async () => {}),
      inspect: vi.fn(async (_memoryItemId: string) => {}),
      forget: vi.fn(async (_selectors: unknown[]) => {}),
      export: vi.fn(() => exportCatchTracker),
    };

    const core = {
      connect,
      disconnect,
      adminModeStore: createStore({
        status: "active",
        elevatedToken: "elevated",
        enteredAt: "2026-02-26T00:00:00.000Z",
        expiresAt: "2026-02-26T00:10:00.000Z",
        remainingMs: 60_000,
      }),
      connectionStore: createStore({
        status: "connected",
        clientId: "client-1",
        transportError: null,
        lastDisconnect: null,
      }),
      approvalsStore: {
        ...createStore({
          pendingIds: [],
          byId: {},
          loading: false,
          error: null,
        }),
        refreshPending: vi.fn(async () => {}),
        resolve: vi.fn(async () => {}),
      },
      pairingStore: {
        ...createStore({
          byId: {},
          pendingIds: [],
          loading: false,
          error: null,
          lastSyncedAt: null,
        }),
        refresh: vi.fn(async () => {}),
        approve: vi.fn(async () => {}),
        deny: vi.fn(async () => {}),
        revoke: vi.fn(async () => {}),
      },
      statusStore: createStore({
        status: null,
        usage: null,
        presenceByInstanceId: {},
        loading: { status: false, usage: false, presence: false },
        error: { status: null, usage: null, presence: null },
        lastSyncedAt: null,
      }),
      runsStore: createStore({
        runsById: {},
        stepIdsByRunId: {},
        stepsById: {},
        attemptIdsByStepId: {},
        attemptsById: {},
      }),
      memoryStore,
    };

    const runtime = createRuntime(core);
    const config = DEFAULT_CONFIG;

    const io = createTestStreams();
    const instance = render(React.createElement(TuiApp, { runtime, config }), {
      stdout: io.stdout,
      stdin: io.stdin,
      exitOnCtrlC: false,
      patchConsole: false,
    });

    try {
      await waitFor(() => connect.mock.calls.length === 1);

      io.stdin.write("6");
      await waitFor(() => memoryStore.list.mock.calls.length === 1);
      memoryStore.list.mockClear();

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
      expect(memoryStore.forget).toHaveBeenCalledWith([{ kind: "id", memory_item_id: "mem-1" }]);

      io.stdin.write("p");
      await waitFor(() => memoryStore.export.mock.calls.length === 1);
      expect(exportCatchAttached).toBe(true);
    } finally {
      instance.unmount();
      await waitFor(() => disconnect.mock.calls.length === 1);
    }
  }, 20_000);

  it("treats an empty Memory search query as list", async () => {
    const connect = vi.fn();
    const disconnect = vi.fn();

    const memoryStore = {
      ...createStore(createMemorySnapshot()),
      list: vi.fn(async () => {}),
      search: vi.fn(async (_input: { query: string }) => {}),
      loadMore: vi.fn(async () => {}),
      inspect: vi.fn(async () => {}),
      forget: vi.fn(async (_selectors: unknown[]) => {}),
      export: vi.fn(async () => {}),
    };

    const core = {
      connect,
      disconnect,
      adminModeStore: createStore({
        status: "inactive",
        elevatedToken: null,
        enteredAt: null,
        expiresAt: null,
        remainingMs: null,
      }),
      connectionStore: createStore({
        status: "connected",
        clientId: "client-1",
        transportError: null,
        lastDisconnect: null,
      }),
      approvalsStore: {
        ...createStore({
          pendingIds: [],
          byId: {},
          loading: false,
          error: null,
        }),
        refreshPending: vi.fn(async () => {}),
        resolve: vi.fn(async () => {}),
      },
      pairingStore: {
        ...createStore({
          byId: {},
          pendingIds: [],
          loading: false,
          error: null,
          lastSyncedAt: null,
        }),
        refresh: vi.fn(async () => {}),
        approve: vi.fn(async () => {}),
        deny: vi.fn(async () => {}),
        revoke: vi.fn(async () => {}),
      },
      statusStore: createStore({
        status: null,
        usage: null,
        presenceByInstanceId: {},
        loading: { status: false, usage: false, presence: false },
        error: { status: null, usage: null, presence: null },
        lastSyncedAt: null,
      }),
      runsStore: createStore({
        runsById: {},
        stepIdsByRunId: {},
        stepsById: {},
        attemptIdsByStepId: {},
        attemptsById: {},
      }),
      memoryStore,
    };

    const runtime = createRuntime(core);
    const config = DEFAULT_CONFIG;

    const io = createTestStreams();
    const instance = render(React.createElement(TuiApp, { runtime, config }), {
      stdout: io.stdout,
      stdin: io.stdin,
      exitOnCtrlC: false,
      patchConsole: false,
    });

    try {
      await waitFor(() => connect.mock.calls.length === 1);

      io.stdin.write("6");
      await waitFor(() => memoryStore.list.mock.calls.length === 1);
      memoryStore.list.mockClear();

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
