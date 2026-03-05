// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

let capturedOnReloadPage: unknown = undefined;

vi.mock("../../src/components/error/error-boundary.js", () => ({
  ErrorBoundary({
    children,
    onReloadPage,
  }: {
    children: React.ReactNode;
    onReloadPage?: () => void;
  }) {
    capturedOnReloadPage = onReloadPage;
    return children;
  },
}));

describe("OperatorUiApp error boundary wiring", () => {
  it("passes onReloadPage to ErrorBoundary", async () => {
    capturedOnReloadPage = undefined;
    const { OperatorUiApp } = await import("../../src/index.js");
    const OperatorUiAppAny = OperatorUiApp as unknown as React.ComponentType<
      Record<string, unknown>
    >;

    const connectionSnapshot = { status: "disconnected" } as const;
    const elevatedModeSnapshot = {
      status: "inactive",
      elevatedToken: null,
      enteredAt: null,
      expiresAt: null,
      remainingMs: null,
    } as const;

    const approvalsSnapshot = {
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    } as const;

    const pairingSnapshot = {
      byId: {},
      pendingIds: [],
      loading: false,
      error: null,
      lastSyncedAt: null,
    } as const;

    const runsSnapshot = {
      runsById: {},
      stepsById: {},
      attemptsById: {},
      stepIdsByRunId: {},
      attemptIdsByStepId: {},
    } as const;

    const autoSyncSnapshot = {
      intervalMs: 30_000,
      tasks: {},
      lastRunAtMs: null,
      lastManualAtMs: null,
      isSyncing: false,
    } as const;

    const statusSnapshot = {
      status: null,
      usage: null,
      presenceByInstanceId: {},
      loading: { status: false, usage: false, presence: false },
      error: { status: null, usage: null, presence: null },
      lastSyncedAt: null,
    } as const;

    const core = {
      connectionStore: {
        subscribe: (_listener: () => void) => () => {},
        getSnapshot: () => connectionSnapshot,
      },
      autoSyncStore: {
        subscribe: (_listener: () => void) => () => {},
        getSnapshot: () => autoSyncSnapshot,
      },
      approvalsStore: {
        subscribe: (_listener: () => void) => () => {},
        getSnapshot: () => approvalsSnapshot,
      },
      pairingStore: {
        subscribe: (_listener: () => void) => () => {},
        getSnapshot: () => pairingSnapshot,
      },
      statusStore: {
        subscribe: (_listener: () => void) => () => {},
        getSnapshot: () => statusSnapshot,
      },
      runsStore: {
        subscribe: (_listener: () => void) => () => {},
        getSnapshot: () => runsSnapshot,
      },
      elevatedModeStore: {
        subscribe: (_listener: () => void) => () => {},
        getSnapshot: () => elevatedModeSnapshot,
        enter: () => {},
        exit: () => {},
        dispose: () => {},
      },
      httpBaseUrl: "http://localhost",
    } as unknown;

    const onReloadPage = vi.fn();

    const { container, root } = renderIntoDocument(
      React.createElement(OperatorUiAppAny, { core, mode: "web", onReloadPage }),
    );

    try {
      expect(capturedOnReloadPage).toBe(onReloadPage);
    } finally {
      cleanupTestRoot({ container, root });
    }
  }, 15_000);
});
