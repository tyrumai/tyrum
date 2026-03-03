// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createElevatedModeStore } from "../../../operator-core/src/stores/elevated-mode-store.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0, now: () => nowMs });
  if (activeAdminMode) {
    elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2026-03-01T00:10:00.000Z",
    });
  }

  const pluginsList = vi.fn(async () => ({ status: "ok", plugins: [] }) as unknown);

  const core = {
    httpBaseUrl: "http://example.test",
    elevatedModeStore,
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

describe("ConfigurePage (strict admin tabs)", () => {
  it("renders admin domain tabs and removes transport tabs", () => {
    const { core } = createCore(false);

    const testRoot = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(ConfigurePage, { core }),
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

  it("keeps admin mutations disabled outside Elevated Mode while allowing read actions", async () => {
    const { core, pluginsList } = createCore(false);

    const testRoot = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(ConfigurePage, { core }),
      ),
    );

    try {
      expect(
        testRoot.container.querySelector("[data-testid='configure-read-only-notice']"),
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

  it("enables admin mutations when Elevated Mode is active", async () => {
    const { core } = createCore(true);

    const testRoot = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(ConfigurePage, { core }),
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

  it("uses the elevated admin token for device token issuance", async () => {
    const { core } = createCore(true);

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          token_kind: "device",
          token: "dev_test",
          token_id: "dev_test_id",
          device_id: "operator-ui",
          role: "client",
          scopes: [],
          issued_at: "2026-03-01T00:00:00.000Z",
          expires_at: "2026-03-01T00:10:00.000Z",
        }),
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const testRoot = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(ConfigurePage, { core }),
      ),
    );

    try {
      await switchAdminTab(testRoot.container, "admin-http-tab-gateway");

      const issueButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-device-tokens-issue']",
      );
      expect(issueButton).not.toBeNull();

      await act(async () => {
        issueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      const checkbox = document.body.querySelector<HTMLButtonElement>(
        "[data-testid='confirm-danger-checkbox']",
      );
      expect(checkbox).not.toBeNull();
      act(() => {
        checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const confirmButton = document.body.querySelector<HTMLButtonElement>(
        "[data-testid='confirm-danger-confirm']",
      );
      expect(confirmButton).not.toBeNull();

      await act(async () => {
        confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [input, init] = fetchMock.mock.calls[0] ?? [];
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";

      expect(url).toBe("http://example.test/auth/device-tokens/issue");
      expect(init?.method).toBe("POST");

      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-elevated-token");

      const bodyRaw = String(init?.body ?? "");
      expect(JSON.parse(bodyRaw)).toEqual({
        device_id: "operator-ui",
        role: "client",
        scopes: [],
        ttl_seconds: 600,
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
