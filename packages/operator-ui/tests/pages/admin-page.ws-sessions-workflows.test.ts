// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { createElevatedModeStore } from "../../../operator-app/src/index.js";
import { AdminAccessProvider } from "../../src/index.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const { executeOperatorCommandMock } = vi.hoisted(() => ({
  executeOperatorCommandMock: vi.fn(async ({ command }: { command: string }) => ({
    output: `ok:${command}`,
  })),
}));

vi.mock("@tyrum/operator-app/browser", async () => {
  const actual = await vi.importActual<typeof import("@tyrum/operator-app/browser")>(
    "@tyrum/operator-app/browser",
  );
  return {
    ...actual,
    executeOperatorCommand: executeOperatorCommandMock,
  };
});

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
} {
  const nowMs = Date.parse("2026-03-01T00:00:00.000Z");
  const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0, now: () => nowMs });
  elevatedModeStore.enter({
    elevatedToken: "elevated-1",
    expiresAt: "2026-03-01T00:10:00.000Z",
  });

  const core = {
    wsUrl: "ws://example.test/ws",
    httpBaseUrl: "http://example.test",
    chatSocket: {
      connected: false,
      requestDynamic: vi.fn(),
      onDynamicEvent: vi.fn(),
      offDynamicEvent: vi.fn(),
    },
    workboard: {
      on: vi.fn(),
      off: vi.fn(),
      workArtifactList: vi.fn(),
      workDecisionList: vi.fn(),
      workGet: vi.fn(),
      workSignalGet: vi.fn(),
      workSignalList: vi.fn(),
      workStateKvGet: vi.fn(),
      workStateKvList: vi.fn(),
      workTransition: vi.fn(),
    },
    elevatedModeStore,
    admin: {
      policy: {
        getBundle: vi.fn(async () => ({ status: "ok" })),
        listOverrides: vi.fn(async () => ({ status: "ok", overrides: [] })),
        createOverride: vi.fn(async () => ({ status: "ok" })),
        revokeOverride: vi.fn(async () => ({ status: "ok" })),
      },
      authTokens: {
        list: vi.fn(async () => ({ tokens: [] })),
        issue: vi.fn(async () => ({ status: "ok" })),
        update: vi.fn(async () => ({ token: {} })),
        revoke: vi.fn(async () => ({ revoked: true })),
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
        listPlans: vi.fn(async () => ({ status: "ok", plans: [] })),
        exportReceiptBundle: vi.fn(async () => ({ status: "ok" })),
        verify: vi.fn(async () => ({ status: "ok" })),
        forget: vi.fn(async () => ({ status: "ok" })),
      },
      agentList: {
        get: vi.fn(async () => ({
          agents: [
            {
              agent_key: "default",
              agent_id: "agent-1",
              has_config: true,
              persona: {
                name: "Default",
                description: "Default agent",
                tone: "direct",
                palette: "blue",
                character: "pragmatic",
              },
            },
          ],
        })),
      },
      routingConfig: {
        get: vi.fn(async () => ({ revision: 1, config: { v: 1 } })),
        listRevisions: vi.fn(async () => ({ revisions: [] })),
        listObservedTelegramThreads: vi.fn(async () => ({ threads: [] })),
        update: vi.fn(async () => ({ revision: 1, config: { v: 1 } })),
        revert: vi.fn(async () => ({ revision: 1, config: { v: 1 } })),
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

  return { core };
}

describe("configure-page WS sections", () => {
  it("does not render sessions/workflows tabs", () => {
    const { core } = createCore();

    const testRoot = renderIntoDocument(
      React.createElement(AdminAccessProvider, {
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
    executeOperatorCommandMock.mockClear();
    const { core } = createCore();

    const testRoot = renderIntoDocument(
      React.createElement(AdminAccessProvider, {
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

      expect(executeOperatorCommandMock).toHaveBeenCalledWith({
        url: "ws://example.test/ws",
        token: "elevated-1",
        command: "/help",
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
