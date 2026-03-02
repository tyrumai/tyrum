// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { AdminModeProvider } from "../../src/admin-mode.js";
import { AdminPage } from "../../src/components/pages/admin-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function createAdminModeStoreActive() {
  const { store } = createStore({
    status: "active",
    elevatedToken: "token-1",
    enteredAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:10:00.000Z",
    remainingMs: 60_000,
  });

  return {
    ...store,
    enter: vi.fn(),
    exit: vi.fn(),
    dispose: vi.fn(),
  };
}

type WsMock = ReturnType<typeof createWsMock>;

function createWsMock() {
  return {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    subagentSpawn: vi.fn(async () => ({})),
    subagentList: vi.fn(async () => ({})),
    subagentGet: vi.fn(async () => ({})),
    subagentSend: vi.fn(async () => ({})),
    subagentClose: vi.fn(async () => ({})),
    commandExecute: vi.fn(async () => ({ output: "ok" })),
  };
}

function createCore(ws: WsMock): OperatorCore {
  return {
    wsUrl: "ws://example.test/ws",
    httpBaseUrl: "http://example.test",
    ws,
    adminModeStore: createAdminModeStoreActive(),
  } as unknown as OperatorCore;
}

describe("AdminPage (WS Subagents)", () => {
  it("does not render subagent operations in the Admin page", () => {
    const ws = createWsMock();
    const core = createCore(ws);

    const testRoot = renderIntoDocument(
      React.createElement(
        AdminModeProvider,
        { core, mode: "desktop" },
        React.createElement(AdminPage, { core }),
      ),
    );

    try {
      expect(testRoot.container.querySelector('[data-testid="admin-ws-subagents"]')).toBeNull();
      expect(
        testRoot.container.querySelector('[data-testid="admin-ws-subagent-spawn-payload"]'),
      ).toBeNull();
      expect(
        testRoot.container.querySelector('[data-testid="admin-ws-tab-commands"]'),
      ).not.toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
