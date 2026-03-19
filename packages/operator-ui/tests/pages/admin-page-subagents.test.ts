// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React from "react";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { createStore } from "../../../operator-app/src/store.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function createElevatedModeStoreActive() {
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
    elevatedModeStore: createElevatedModeStoreActive(),
  } as unknown as OperatorCore;
}

describe("ConfigurePage (WS Subagents)", () => {
  it("does not render subagent operations in Configure", () => {
    const ws = createWsMock();
    const core = createCore(ws);

    const testRoot = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "desktop" },
        React.createElement(ConfigurePage, { core }),
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
