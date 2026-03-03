// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createElevatedModeStore } from "../../../operator-core/src/index.js";
import { ElevatedModeProvider } from "../../src/index.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

async function switchAdminTab(container: HTMLElement, testId: string): Promise<void> {
  const tab = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  expect(tab).not.toBeNull();
  await act(async () => {
    tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
}

function createCore(): {
  core: OperatorCore;
  commandExecute: ReturnType<typeof vi.fn>;
} {
  const nowMs = Date.parse("2026-03-01T00:00:00.000Z");
  const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0, now: () => nowMs });
  elevatedModeStore.enter({
    elevatedToken: "elevated-1",
    expiresAt: "2026-03-01T00:10:00.000Z",
  });

  const commandExecute = vi.fn(async (command: string) => ({ output: `ok:${command}` }));

  const core = {
    httpBaseUrl: "http://example.test",
    ws: {
      on: vi.fn(),
      off: vi.fn(),
      commandExecute,
    },
    elevatedModeStore,
    http: {
      policy: {
        getBundle: vi.fn(async () => ({ status: "ok" })),
        listOverrides: vi.fn(async () => ({ status: "ok", overrides: [] })),
        createOverride: vi.fn(async () => ({ status: "ok" })),
        revokeOverride: vi.fn(async () => ({ status: "ok" })),
      },
      authProfiles: {
        list: vi.fn(async () => ({ status: "ok", profiles: [] })),
        create: vi.fn(async () => ({ status: "ok" })),
        update: vi.fn(async () => ({ status: "ok" })),
        disable: vi.fn(async () => ({ status: "ok" })),
        enable: vi.fn(async () => ({ status: "ok" })),
      },
      authPins: {
        list: vi.fn(async () => ({ status: "ok", pins: [] })),
        set: vi.fn(async () => ({ status: "ok" })),
      },
      audit: {
        exportReceiptBundle: vi.fn(async () => ({ status: "ok" })),
        verify: vi.fn(async () => ({ status: "ok" })),
        forget: vi.fn(async () => ({ status: "ok" })),
      },
      routingConfig: {
        get: vi.fn(async () => ({ revision: 0, config: {} })),
        update: vi.fn(async () => ({ revision: 1, config: {} })),
        revert: vi.fn(async () => ({ revision: 0, config: {} })),
      },
      secrets: {
        list: vi.fn(async () => ({ handles: [] })),
        store: vi.fn(async () => ({ handle: {} })),
        rotate: vi.fn(async () => ({ revoked: true })),
        revoke: vi.fn(async () => ({ revoked: true })),
      },
      plugins: {
        list: vi.fn(async () => ({ status: "ok", plugins: [] })),
        get: vi.fn(async () => ({ status: "ok", plugin: {} })),
      },
      deviceTokens: {
        issue: vi.fn(async () => ({ status: "ok" })),
        revoke: vi.fn(async () => ({ status: "ok" })),
      },
      models: {
        refresh: vi.fn(async () => ({ status: "ok" })),
      },
    },
  } as unknown as OperatorCore;

  return { core, commandExecute };
}

describe("configure-page WS sections", () => {
  it("does not render sessions/workflows tabs", () => {
    const { core } = createCore();

    const testRoot = renderIntoDocument(
      React.createElement(ElevatedModeProvider, {
        core,
        mode: "desktop",
        children: React.createElement(ConfigurePage, { core }),
      }),
    );

    try {
      expect(testRoot.container.querySelector('[data-testid="admin-ws-tab-sessions"]')).toBeNull();
      expect(testRoot.container.querySelector('[data-testid="admin-ws-tab-workflows"]')).toBeNull();
      expect(
        testRoot.container.querySelector('[data-testid="admin-ws-tab-commands"]'),
      ).not.toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("executes commands via the remaining WS admin tab", async () => {
    const { core, commandExecute } = createCore();

    const testRoot = renderIntoDocument(
      React.createElement(ElevatedModeProvider, {
        core,
        mode: "desktop",
        children: React.createElement(ConfigurePage, { core }),
      }),
    );

    try {
      await switchAdminTab(testRoot.container, "admin-ws-tab-commands");
      const runButton = testRoot.container.querySelector<HTMLButtonElement>(
        '[data-testid="admin-ws-command-run"]',
      );
      expect(runButton).not.toBeNull();

      await act(async () => {
        runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(commandExecute).toHaveBeenCalledWith("/help");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
