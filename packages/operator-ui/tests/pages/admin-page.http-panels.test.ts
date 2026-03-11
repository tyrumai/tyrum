// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createElevatedModeStore } from "../../../operator-core/src/stores/elevated-mode-store.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import { ThemeProvider } from "../../src/hooks/use-theme.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;

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
} {
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
      authTokens: {
        list: vi.fn(async () => ({ tokens: [] })),
        issue: vi.fn(async () => ({
          token: "tyrum-token.v1.token-id.secret",
          token_id: "token-1",
          tenant_id: "11111111-1111-4111-8111-111111111111",
          role: "client",
          device_id: "operator-ui",
          scopes: [],
          issued_at: "2026-03-01T00:00:00.000Z",
        })),
        revoke: vi.fn(async () => ({ revoked: true, token_id: "token-1" })),
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
      providerConfig: {
        listRegistry: vi.fn(async () => ({
          status: "ok",
          providers: [
            {
              provider_key: "openai",
              name: "OpenAI",
              doc: null,
              supported: true,
              methods: [
                {
                  method_key: "api_key",
                  label: "API key",
                  type: "api_key",
                  fields: [
                    {
                      key: "api_key",
                      label: "API key",
                      description: null,
                      kind: "secret",
                      input: "password",
                      required: true,
                    },
                  ],
                },
              ],
            },
          ],
        })),
        listProviders: vi.fn(async () => ({ status: "ok", providers: [] })),
        createAccount: vi.fn(async () => ({ status: "ok" })),
        updateAccount: vi.fn(async () => ({ status: "ok" })),
        deleteAccount: vi.fn(async () => ({ status: "ok" })),
        deleteProvider: vi.fn(async () => ({ status: "ok" })),
      },
      audit: {
        listPlans: vi.fn(async () => ({ status: "ok", plans: [] })),
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
      deviceTokens: {
        issue: vi.fn(async () => ({ status: "ok" })),
        revoke: vi.fn(async () => ({ status: "ok" })),
      },
      modelConfig: {
        listPresets: vi.fn(async () => ({ status: "ok", presets: [] })),
        listAvailable: vi.fn(async () => ({
          status: "ok",
          models: [
            {
              provider_key: "openai",
              provider_name: "OpenAI",
              model_id: "gpt-4.1",
              model_name: "GPT-4.1",
              family: null,
              reasoning: true,
              tool_call: true,
              modalities: { output: ["text"] },
            },
          ],
        })),
        createPreset: vi.fn(async () => ({ status: "ok" })),
        updatePreset: vi.fn(async () => ({ status: "ok" })),
        deletePreset: vi.fn(async () => ({ status: "ok" })),
        listAssignments: vi.fn(async () => ({
          status: "ok",
          assignments: EXECUTION_PROFILE_IDS.map((execution_profile_id) => ({
            execution_profile_id,
            preset_key: "preset-default",
            preset_display_name: "Default",
            provider_key: "openai",
            model_id: "gpt-4.1",
          })),
        })),
        updateAssignments: vi.fn(async () => ({ status: "ok", assignments: [] })),
      },
      models: {
        refresh: vi.fn(async () => ({ status: "ok" })),
      },
    },
  } as unknown as OperatorCore;

  return { core };
}

describe("ConfigurePage (strict admin tabs)", () => {
  it("renders admin domain tabs and removes transport tabs", () => {
    const { core } = createCore(false);

    const testRoot = renderIntoDocument(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          ElevatedModeProvider,
          { core, mode: "web" },
          React.createElement(ConfigurePage, { core }),
        ),
      ),
    );

    try {
      expect(testRoot.container.querySelector("[data-testid='admin-tab-http']")).toBeNull();
      expect(testRoot.container.querySelector("[data-testid='admin-tab-ws']")).toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='configure-tab-general']"),
      ).not.toBeNull();

      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-policy']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-providers']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-http-tab-models']"),
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
        testRoot.container.querySelector("[data-testid='admin-http-tab-gateway']"),
      ).not.toBeNull();
      expect(
        testRoot.container.querySelector("[data-testid='admin-ws-tab-commands']"),
      ).not.toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("keeps admin mutations disabled outside Elevated Mode", async () => {
    const { core } = createCore(false);

    const testRoot = renderIntoDocument(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          ElevatedModeProvider,
          { core, mode: "web" },
          React.createElement(ConfigurePage, { core }),
        ),
      ),
    );

    try {
      await switchAdminTab(testRoot.container, "admin-http-tab-gateway");
      const issueButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-tokens-issue']",
      );
      expect(issueButton).not.toBeNull();
      expect(issueButton?.closest("[data-elevated-mode-guard]")).not.toBeNull();

      await switchAdminTab(testRoot.container, "admin-http-tab-providers");
      const addProviderButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='providers-add-open']",
      );
      expect(addProviderButton).not.toBeNull();
      expect(addProviderButton?.closest("[data-elevated-mode-guard]")).not.toBeNull();

      await switchAdminTab(testRoot.container, "admin-http-tab-models");
      const addModelButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='models-add-open']",
      );
      expect(addModelButton).not.toBeNull();
      expect(addModelButton?.closest("[data-elevated-mode-guard]")).not.toBeNull();

      await switchAdminTab(testRoot.container, "admin-http-tab-policy");
      const createOverrideButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-policy-override-create']",
      );
      expect(createOverrideButton).not.toBeNull();
      expect(createOverrideButton?.closest("[data-elevated-mode-guard]")).not.toBeNull();
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("enables admin mutations when Elevated Mode is active", async () => {
    const { core } = createCore(true);

    const testRoot = renderIntoDocument(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          ElevatedModeProvider,
          { core, mode: "web" },
          React.createElement(ConfigurePage, { core }),
        ),
      ),
    );

    try {
      await switchAdminTab(testRoot.container, "admin-http-tab-gateway");
      const issueButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-tokens-issue']",
      );
      expect(issueButton).not.toBeNull();
      expect(issueButton?.disabled).toBe(false);

      await switchAdminTab(testRoot.container, "admin-http-tab-providers");
      const addProviderButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='providers-add-open']",
      );
      expect(addProviderButton).not.toBeNull();
      expect(addProviderButton?.disabled).toBe(false);

      await switchAdminTab(testRoot.container, "admin-http-tab-models");
      const addModelButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='models-add-open']",
      );
      expect(addModelButton).not.toBeNull();
      expect(addModelButton?.disabled).toBe(false);
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("uses the elevated admin token for tenant token issuance", async () => {
    const { core } = createCore(true);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "http://example.test/auth/tokens" && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ tokens: [] }), { status: 200 });
      }
      if (url === "http://example.test/auth/tokens/issue" && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            token: "tyrum-token.v1.token-id.secret",
            token_id: "dev_test_id",
            tenant_id: "11111111-1111-4111-8111-111111111111",
            device_id: "operator-ui",
            role: "client",
            scopes: [],
            issued_at: "2026-03-01T00:00:00.000Z",
          }),
          { status: 201 },
        );
      }
      throw new Error(`Unexpected fetch request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const testRoot = renderIntoDocument(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          ElevatedModeProvider,
          { core, mode: "web" },
          React.createElement(ConfigurePage, { core }),
        ),
      ),
    );

    try {
      await switchAdminTab(testRoot.container, "admin-http-tab-gateway");

      const issueButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-tokens-issue']",
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

      const issueCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(issueCall).toBeDefined();
      const [input, init] = issueCall ?? [];
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";

      expect(url).toBe("http://example.test/auth/tokens/issue");
      expect(init?.method).toBe("POST");

      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-elevated-token");

      const bodyRaw = String(init?.body ?? "");
      expect(JSON.parse(bodyRaw)).toEqual({
        role: "client",
        scopes: [],
        device_id: "operator-ui",
        ttl_seconds: 600,
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows expired tenant tokens as expired and disables revoke", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));

    const { core } = createCore(true);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "http://example.test/auth/tokens" && (!init?.method || init.method === "GET")) {
        return new Response(
          JSON.stringify({
            tokens: [
              {
                token_id: "expired-token",
                tenant_id: "11111111-1111-4111-8111-111111111111",
                role: "client",
                device_id: "operator-ui",
                scopes: ["operator.read"],
                issued_at: "2026-02-01T00:00:00.000Z",
                expires_at: "2026-02-28T23:59:59.000Z",
                revoked_at: null,
                created_at: "2026-02-01T00:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const testRoot = renderIntoDocument(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          ElevatedModeProvider,
          { core, mode: "web" },
          React.createElement(ConfigurePage, { core }),
        ),
      ),
    );

    try {
      await switchAdminTab(testRoot.container, "admin-http-tab-gateway");
      expect(testRoot.container.textContent).toContain("Expired");

      const revokeButton = testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-token-revoke-expired-token']",
      );
      expect(revokeButton).not.toBeNull();
      expect(revokeButton?.disabled).toBe(true);
    } finally {
      cleanupTestRoot(testRoot);
      vi.useRealTimers();
    }
  });
});
