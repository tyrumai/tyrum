// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createAdminModeStore } from "../../../operator-core/src/stores/admin-mode-store.js";
import { AdminModeProvider } from "../../src/admin-mode.js";
import { AdminPage } from "../../src/components/pages/admin-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

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
  pluginsList: ReturnType<typeof vi.fn>;
} {
  const nowMs = Date.parse("2026-03-01T00:00:00.000Z");
  const adminModeStore = createAdminModeStore({ tickIntervalMs: 0, now: () => nowMs });
  if (activeAdminMode) {
    adminModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2026-03-01T00:10:00.000Z",
    });
  }

  const pluginsList = vi.fn(async () => ({ status: "ok", plugins: [] }) as unknown);

  const core = {
    httpBaseUrl: "http://example.test",
    adminModeStore,
    ws: {
      commandExecute: vi.fn(async () => ({ output: "ok" })),
    },
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
        list: pluginsList,
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

  return { core, pluginsList };
}

describe("AdminPage (strict admin tabs)", () => {
  it("renders admin domain tabs and removes transport tabs", () => {
    const { core } = createCore(false);

    const testRoot = renderIntoDocument(
      React.createElement(
        AdminModeProvider,
        { core, mode: "web" },
        React.createElement(AdminPage, { core }),
      ),
    );

    try {
      expect(testRoot.container.querySelector("[data-testid='admin-tab-http']")).toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-tab-ws']")).toBeNull();

      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-policy-auth']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-audit']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-routing-config']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-secrets']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-plugins']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-gateway']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-models-refresh']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-ws-tab-commands']"),
      ).not.toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("keeps admin mutations disabled outside Admin Mode while allowing read actions", async () => {
    const { core, pluginsList } = createCore(false);

    const testRoot = renderIntoDocument(
      React.createElement(
        AdminModeProvider,
        { core, mode: "web" },
        React.createElement(AdminPage, { core }),
      ),
    );

    try {
      expect(
        testRoot.container.querySelector("[data-testid='admin-read-only-notice']"),
      ).not.toBeNull();

      await switchAdminTab(testRoot.container, "admin-http-tab-plugins");
      const listPluginsButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-plugins-list']",
      );
      expect(listPluginsButton).not.toBeNull();
      await act(async () => {
        listPluginsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
      expect(pluginsList).toHaveBeenCalledTimes(1);

      await switchAdminTab(testRoot.container, "admin-http-tab-gateway");
      const issueButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-device-tokens-issue']",
      );
      expect(issueButton).not.toBeNull();
      expect(issueButton?.disabled).toBe(true);

      await switchAdminTab(testRoot.container, "admin-http-tab-models-refresh");
      const refreshButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-models-refresh-open']",
      );
      expect(refreshButton).not.toBeNull();
      expect(refreshButton?.disabled).toBe(true);

      await switchAdminTab(testRoot.container, "admin-http-tab-policy-auth");
      const createOverrideButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-policy-override-create']",
      );
      expect(createOverrideButton).not.toBeNull();
      expect(createOverrideButton?.disabled).toBe(true);
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("enables admin mutations when Admin Mode is active", async () => {
    const { core } = createCore(true);

    const testRoot = renderIntoDocument(
      React.createElement(
        AdminModeProvider,
        { core, mode: "web" },
        React.createElement(AdminPage, { core }),
      ),
    );

    try {
      await switchAdminTab(testRoot.container, "admin-http-tab-gateway");
      const issueButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-device-tokens-issue']",
      );
      expect(issueButton).not.toBeNull();
      expect(issueButton?.disabled).toBe(false);

      await switchAdminTab(testRoot.container, "admin-http-tab-models-refresh");
      const refreshButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-models-refresh-open']",
      );
      expect(refreshButton).not.toBeNull();
      expect(refreshButton?.disabled).toBe(false);
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
