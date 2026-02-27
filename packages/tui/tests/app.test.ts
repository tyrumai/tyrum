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
  const stdout = new PassThrough() as PassThrough & { columns: number; rows: number };
  stdout.columns = 80;
  stdout.rows = 24;
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

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
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

    const manager = {
      getCore: () => core,
      subscribe: () => () => {},
      dispose: () => {},
    };

    const runtime = {
      manager,
      enterAdminMode: vi.fn(async () => {}),
      exitAdminMode: vi.fn(() => {}),
      dispose: vi.fn(() => {}),
    };

    const config = {
      httpBaseUrl: "http://127.0.0.1:8788",
      wsUrl: "ws://127.0.0.1:8788/ws",
      token: "token",
      deviceIdentityPath: "/tmp/device-identity.json",
      reconnect: false,
      tlsCertFingerprint256: undefined,
    };

    const io = createTestStreams();
    const instance = render(React.createElement(TuiApp, { runtime, config }), {
      stdout: io.stdout,
      stdin: io.stdin,
      exitOnCtrlC: false,
      patchConsole: false,
    });

    try {
      await tick();
      expect(connect).toHaveBeenCalledTimes(1);
      expect(io.readOutput()).toContain("Tyrum TUI (connect)");

      await tick();
      io.stdin.write("2");
      await tick();
      expect(io.readOutput()).toContain("Tyrum TUI (status)");

      io.stdin.write("3");
      await tick();
      await tick();
      expect(io.readOutput()).toContain("Tyrum TUI (approvals)");

      io.stdin.write("5");
      await tick();
      await tick();
      expect(io.readOutput()).toContain("Tyrum TUI (pairing)");

      io.stdin.write("4");
      await tick();
      await tick();
      expect(io.readOutput()).toContain("Tyrum TUI (runs)");

      io.stdin.write("m");
      await tick();
      await tick();
      expect(io.readOutput()).toContain("Enter Admin Mode");
    } finally {
      instance.unmount();
      await tick();
      expect(disconnect).toHaveBeenCalledTimes(1);
    }
  });
});
