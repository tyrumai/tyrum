// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { createElevatedModeStore } from "../../../operator-app/src/index.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import * as adminHttpShared from "../../src/components/pages/admin-http-shared.js";
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

function createCore(activeAdminMode: boolean): { core: OperatorCore } {
  const nowMs = Date.parse("2026-03-01T00:00:00.000Z");
  const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0, now: () => nowMs });
  if (activeAdminMode) {
    elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2026-03-01T00:10:00.000Z",
    });
  }

  const core = {
    httpBaseUrl: "http://example.test",
    wsUrl: "ws://example.test/ws",
    elevatedModeStore,
    ws: { on: vi.fn(), off: vi.fn(), commandExecute: vi.fn() },
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
  } as unknown as OperatorCore & {
    http: OperatorCore["admin"];
    ws: unknown;
  };
  core.admin = core.http;
  core.workboard = core.ws as OperatorCore["workboard"];
  core.chatSocket = core.ws as OperatorCore["chatSocket"];

  return { core };
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
      expect(
        testRoot.container.querySelector("[data-testid='admin-ws-tab-conversations']"),
      ).toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-ws-tab-workflows']")).toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-ws-tab-workboard']")).toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-ws-subagents']")).toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("runs command.execute with trimmed command text in Elevated Mode", async () => {
    const { core } = createCore(true);
    const executeAdminWsCommand = vi
      .spyOn(adminHttpShared, "executeAdminWsCommand")
      .mockResolvedValue({ output: "ok:/help" });

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

      expect(executeAdminWsCommand).toHaveBeenCalledTimes(1);
      expect(executeAdminWsCommand).toHaveBeenCalledWith({ core, command: "/help" });
    } finally {
      executeAdminWsCommand.mockRestore();
      cleanupTestRoot(testRoot);
    }
  });

  it("replaces the commands panel with an admin-access gate when access expires", async () => {
    const { core } = createCore(true);
    const executeAdminWsCommand = vi.spyOn(adminHttpShared, "executeAdminWsCommand");

    const testRoot = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(ConfigurePage, { core }),
      ),
    );

    try {
      await switchAdminTab(testRoot.container, "admin-ws-tab-commands");

      act(() => {
        core.elevatedModeStore.exit();
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(executeAdminWsCommand).not.toHaveBeenCalled();
      expect(testRoot.container.querySelector("[data-testid='admin-ws-command-panel']")).toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-access-gate']")).not.toBeNull();
    } finally {
      executeAdminWsCommand.mockRestore();
      cleanupTestRoot(testRoot);
    }
  });

  it("shows an admin-access gate when command access is inactive", async () => {
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

      expect(testRoot.container.querySelector("[data-testid='admin-ws-command-panel']")).toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-access-gate']")).not.toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
