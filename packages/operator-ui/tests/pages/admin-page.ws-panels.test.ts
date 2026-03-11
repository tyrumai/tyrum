// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createElevatedModeStore } from "../../../operator-core/src/index.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function setReactTextValue(el: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  descriptor?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function switchAdminTab(container: HTMLElement, testId: string): Promise<void> {
  const tab = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  expect(tab).not.toBeNull();
  await act(async () => {
    tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
}

function createCore(activeAdminMode: boolean): {
  core: OperatorCore;
  commandExecute: ReturnType<typeof vi.fn>;
} {
  const nowMs = Date.parse("2026-03-01T00:00:00.000Z");
  const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0, now: () => nowMs });
  if (activeAdminMode) {
    elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2026-03-01T00:10:00.000Z",
    });
  }

  const commandExecute = vi.fn(async (command: string) => ({ output: `ok:${command}` }));

  const core = {
    httpBaseUrl: "http://example.test",
    elevatedModeStore,
    ws: {
      on: vi.fn(),
      off: vi.fn(),
      commandExecute,
    },
    http: {
      policy: {
        getBundle: vi.fn(async () => ({ status: "ok" })),
        listOverrides: vi.fn(async () => ({ status: "ok", overrides: [] })),
        createOverride: vi.fn(async () => ({ status: "ok" })),
        revokeOverride: vi.fn(async () => ({ status: "ok" })),
      },
      authTokens: {
        list: vi.fn(async () => ({ tokens: [] })),
        issue: vi.fn(async () => ({ status: "ok" })),
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

  return { core, commandExecute };
}

describe("ConfigurePage WebSocket panels", () => {
  it("renders command controls and omits removed WS diagnostics controls", async () => {
    const { core } = createCore(true);

    const testRoot = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(ConfigurePage, { core }),
      ),
    );

    try {
      await switchAdminTab(testRoot.container, "admin-ws-tab-commands");

      expect(
        testRoot.container.querySelector("[data-testid='admin-ws-command-panel']"),
      ).not.toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-ws-ping-run']")).toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-ws-presence-beacon-send']"),
      ).toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-ws-capability-ready-send']"),
      ).toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-ws-attempt-evidence-send']"),
      ).toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-ws-tab-sessions']")).toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-ws-tab-workflows']")).toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-ws-tab-workboard']")).toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-ws-subagents']")).toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("runs command.execute with trimmed command text in Elevated Mode", async () => {
    const { core, commandExecute } = createCore(true);

    const testRoot = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(ConfigurePage, { core }),
      ),
    );

    try {
      await switchAdminTab(testRoot.container, "admin-ws-tab-commands");

      const commandInput = testRoot.container.querySelector<HTMLInputElement>(
        "[data-testid='admin-ws-command-input']",
      );
      expect(commandInput).not.toBeNull();

      act(() => {
        setReactTextValue(commandInput!, "  /help  ");
      });

      const commandButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-ws-command-run']",
      );
      expect(commandButton).not.toBeNull();

      await act(async () => {
        commandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(commandExecute).toHaveBeenCalledTimes(1);
      expect(commandExecute).toHaveBeenCalledWith("/help");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("does not run command.execute when Elevated Mode expires before the click handler runs", async () => {
    const { core, commandExecute } = createCore(true);

    const testRoot = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(ConfigurePage, { core }),
      ),
    );

    try {
      await switchAdminTab(testRoot.container, "admin-ws-tab-commands");

      const commandButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-ws-command-run']",
      );
      expect(commandButton).not.toBeNull();
      expect(commandButton?.disabled).toBe(false);

      const activeSnapshot = core.elevatedModeStore.getSnapshot();
      const inactiveSnapshot = {
        ...activeSnapshot,
        status: "inactive",
        elevatedToken: null,
        enteredAt: null,
        expiresAt: null,
        remainingMs: null,
      };
      core.elevatedModeStore.getSnapshot = () => inactiveSnapshot;

      await act(async () => {
        commandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(commandExecute).not.toHaveBeenCalled();
      expect(document.body.querySelector("[data-testid='elevated-mode-dialog']")).not.toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("disables command.execute when Elevated Mode is inactive", async () => {
    const { core } = createCore(false);

    const testRoot = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(ConfigurePage, { core }),
      ),
    );

    try {
      await switchAdminTab(testRoot.container, "admin-ws-tab-commands");

      const commandButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-ws-command-run']",
      );
      expect(commandButton).not.toBeNull();
      expect(commandButton?.closest("[data-elevated-mode-guard]")).not.toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
