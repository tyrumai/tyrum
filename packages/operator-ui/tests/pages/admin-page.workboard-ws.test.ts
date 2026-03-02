// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import type {
  AdminModeState,
  AdminModeStore,
} from "../../../operator-core/src/stores/admin-mode-store.js";
import { AdminModeProvider } from "../../src/admin-mode.js";
import { AdminPage } from "../../src/components/pages/admin-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function createActiveAdminModeStore(): AdminModeStore {
  const activeState: AdminModeState = {
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

describe("AdminPage WorkBoard WS panels", () => {
  it("does not render workboard controls in Admin page", () => {
    const adminModeStore = createActiveAdminModeStore();

    const core = {
      httpBaseUrl: "http://example.test",
      adminModeStore,
      ws: {
        on: vi.fn(),
        off: vi.fn(),
        commandExecute: vi.fn(async () => ({ output: "ok" })),
      },
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(
      React.createElement(AdminModeProvider, {
        core,
        mode: "web",
        children: React.createElement(AdminPage, { core }),
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
    const commandExecute = vi.fn(async () => ({ output: "ok" }));
    const adminModeStore = createActiveAdminModeStore();

    const core = {
      httpBaseUrl: "http://example.test",
      adminModeStore,
      ws: {
        on: vi.fn(),
        off: vi.fn(),
        commandExecute,
      },
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(
      React.createElement(AdminModeProvider, {
        core,
        mode: "web",
        children: React.createElement(AdminPage, { core }),
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
