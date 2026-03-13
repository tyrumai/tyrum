// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import type {
  ElevatedModeState,
  ElevatedModeStore,
} from "../../../operator-core/src/stores/elevated-mode-store.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const { executeAdminWsCommand } = vi.hoisted(() => ({
  executeAdminWsCommand: vi.fn(async () => ({ output: "ok" })),
}));

vi.mock("../../src/components/pages/admin-http-shared.js", async () => {
  const actual = await import("../../src/components/pages/admin-http-shared.js");
  return {
    ...actual,
    executeAdminWsCommand,
  };
});

function createActiveElevatedModeStore(): ElevatedModeStore {
  const activeState: ElevatedModeState = {
    status: "active",
    elevatedToken: "token",
    enteredAt: "2026-03-01T00:00:00.000Z",
    expiresAt: "2026-03-01T00:10:00.000Z",
    remainingMs: 60_000,
  };

  const { store } = createStore(activeState);
  return {
    ...store,
    enter: vi.fn(),
    exit: vi.fn(),
    dispose: vi.fn(),
  };
}

async function switchAdminTab(container: HTMLElement, testId: string): Promise<void> {
  const tab = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  expect(tab).not.toBeNull();
  await act(async () => {
    tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
}

describe("ConfigurePage WorkBoard WS panels", () => {
  it("does not render workboard controls in Configure", () => {
    const elevatedModeStore = createActiveElevatedModeStore();

    const core = {
      httpBaseUrl: "http://example.test",
      elevatedModeStore,
      ws: {
        on: vi.fn(),
        off: vi.fn(),
        commandExecute: vi.fn(async () => ({ output: "ok" })),
      },
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(
      React.createElement(ElevatedModeProvider, {
        core,
        mode: "web",
        children: React.createElement(ConfigurePage, { core }),
      }),
    );

    try {
      expect(testRoot.container.querySelector('[data-testid="admin-ws-tab-workboard"]')).toBeNull();
      expect(testRoot.container.querySelector('[data-testid="work-scope-tenant-id"]')).toBeNull();
      expect(testRoot.container.querySelector('[data-testid="admin-ws-work-list-run"]')).toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("keeps command.execute available as the WS admin action", async () => {
    executeAdminWsCommand.mockClear();
    const elevatedModeStore = createActiveElevatedModeStore();

    const core = {
      httpBaseUrl: "http://example.test",
      elevatedModeStore,
      ws: {
        on: vi.fn(),
        off: vi.fn(),
        commandExecute: vi.fn(async () => ({ output: "ok" })),
      },
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(
      React.createElement(ElevatedModeProvider, {
        core,
        mode: "web",
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

      expect(executeAdminWsCommand).toHaveBeenCalledWith({ core, command: "/help" });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
