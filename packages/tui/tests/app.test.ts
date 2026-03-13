import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "ink";
import { TuiApp } from "../src/app.js";
import {
  createConnectionStore,
  createCore,
  createElevatedModeStore,
  createEmptyApprovalsStore,
  createPairingStore,
  createRuntime,
  createTestStreams,
  DEFAULT_CONFIG,
  sleep,
  waitFor,
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
  return { io, instance, runtime };
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
        pendingIds: ["approval-1"],
        byId: {
          "approval-1": {
            approval_id: "approval-1",
            status: "awaiting_human",
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
            status: "awaiting_human",
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
      await sleep(150);

      io.stdin.write("c");
      await waitFor(() => connect.mock.calls.length === 3);
    } finally {
      instance.unmount();
      await waitFor(() => disconnect.mock.calls.length === 2);
      expect(disconnect).toHaveBeenCalledTimes(2);
    }
  }, 20_000);

  it("wires approvals and pairing shortcuts to the active stores", async () => {
    const connect = vi.fn();
    const disconnect = vi.fn();
    const approvalsStore = createEmptyApprovalsStore({
      pendingIds: ["approval-1"],
      byId: {
        "approval-1": {
          approval_id: "approval-1",
          status: "awaiting_human",
          kind: "tool",
          prompt: "Approve?",
          created_at: "2026-02-26T00:00:00.000Z",
        },
      },
    });
    const pairingStore = createPairingStore({
      byId: {
        10: {
          pairing_id: 10,
          status: "awaiting_human",
          node: { node_id: "node-1", label: null, capabilities: [] },
          capability_allowlist: ["runs.read"],
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
    });
    const core = createCore({
      connect,
      disconnect,
      elevatedModeStore: createElevatedModeStore("active"),
      connectionStore: createConnectionStore("connected"),
      approvalsStore,
      pairingStore,
    });
    const { io, instance } = renderTuiApp(core);

    try {
      await waitFor(() => connect.mock.calls.length === 1);

      io.stdin.write("3");
      await sleep(25);
      io.stdin.write("r");
      await waitFor(() => approvalsStore.refreshPending.mock.calls.length === 1);

      io.stdin.write("a");
      await waitFor(() => approvalsStore.resolve.mock.calls.length === 1);
      expect(approvalsStore.resolve).toHaveBeenCalledWith({
        approvalId: "approval-1",
        decision: "approved",
      });

      io.stdin.write("5");
      await sleep(25);
      io.stdin.write("r");
      await waitFor(() => pairingStore.refresh.mock.calls.length === 1);

      io.stdin.write("a");
      await waitFor(() => pairingStore.approve.mock.calls.length === 1);
      expect(pairingStore.approve).toHaveBeenCalledWith(10, {
        trust_level: "local",
        capability_allowlist: ["runs.read"],
      });

      io.stdin.write("\u001b[B");
      await sleep(50);
      io.stdin.write("v");
      await waitFor(() => pairingStore.revoke.mock.calls.length === 1);
      expect(pairingStore.revoke).toHaveBeenCalledWith(11);
    } finally {
      instance.unmount();
      await waitFor(() => disconnect.mock.calls.length === 1);
    }
  }, 20_000);
});
