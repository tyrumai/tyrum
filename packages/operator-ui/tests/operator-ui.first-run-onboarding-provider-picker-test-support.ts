import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import { stubAdminHttpFetch } from "./admin-http-fetch-test-support.js";
import {
  TEST_DEVICE_IDENTITY,
  requestInfoToUrl,
  setControlledInputValue,
  stubPersistentStorage,
  waitForSelector,
} from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";
import {
  buildIssueStatusResponse,
  cleanup,
  createConfiguredProviderGroup,
  findButtonByText,
  getInputByLabel,
  setInputByLabel,
} from "./operator-ui.first-run-onboarding.helpers.js";

function createRegistryProvider(providerKey: string, name: string) {
  return {
    provider_key: providerKey,
    name,
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
  };
}

export function registerFirstRunOnboardingProviderPickerTests(): void {
  it("filters providers, auto-selects OpenAI, and saves the visible provider selection", async () => {
    stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();
    let providers: ReturnType<typeof createConfiguredProviderGroup>[] = [];
    let savedBody: {
      config: Record<string, unknown>;
      display_name: string;
      provider_key: string;
      method_key: string;
      secrets: Record<string, string>;
    } | null = null;

    http.providerConfig.listRegistry = vi.fn(async () => ({
      status: "ok" as const,
      providers: [
        createRegistryProvider("302ai", "302.AI"),
        createRegistryProvider("openai", "OpenAI"),
      ],
    }));
    http.providerConfig.listProviders = vi.fn(async () => ({
      status: "ok" as const,
      providers,
    }));
    http.modelConfig.listPresets = vi.fn(async () => ({ status: "ok" as const, presets: [] }));

    statusGet.mockImplementation(async () => {
      if (providers.length === 0) {
        return buildIssueStatusResponse([
          {
            code: "no_provider_accounts",
            severity: "error",
            message: "No active provider accounts are configured.",
            target: { kind: "deployment", id: null },
          },
        ]);
      }
      return buildIssueStatusResponse([
        {
          code: "no_model_presets",
          severity: "error",
          message: "No model presets are configured.",
          target: { kind: "deployment", id: null },
        },
      ]);
    });

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    core.elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    stubAdminHttpFetch(core, async (input, init) => {
      const url = requestInfoToUrl(input);
      if (!url.endsWith("/config/providers/accounts")) {
        throw new Error(`Unexpected fetch call: ${url}`);
      }

      savedBody = JSON.parse(String(init?.body)) as typeof savedBody;
      const providerGroup = createConfiguredProviderGroup();
      providers = [
        {
          ...providerGroup,
          provider_key: savedBody!.provider_key,
          name: savedBody!.display_name,
          accounts: [
            {
              ...providerGroup.accounts[0],
              display_name: savedBody!.display_name,
              provider_key: savedBody!.provider_key,
              method_key: savedBody!.method_key,
            },
          ],
        },
      ];

      return new Response(JSON.stringify({ status: "ok", account: providers[0]!.accounts[0] }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      await Promise.resolve();
    });

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-provider"]');
    const filterInput = container.querySelector<HTMLInputElement>(
      '[data-testid="providers-filter-input"]',
    );
    const displayNameInput = getInputByLabel(container, "Display name");

    expect(filterInput).not.toBeNull();
    expect(displayNameInput).not.toBeNull();
    expect(displayNameInput?.value).toBe("302.AI");

    await act(async () => {
      setControlledInputValue(filterInput!, "open");
      await Promise.resolve();
    });

    const openaiOption = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="providers-provider-option-openai"]',
    );
    expect(container.querySelector('[data-testid="providers-provider-option-302ai"]')).toBeNull();
    expect(openaiOption.getAttribute("aria-checked")).toBe("true");
    expect(displayNameInput?.value).toBe("OpenAI");

    setInputByLabel(container, "API key", "sk-openai");
    await act(async () => {
      findButtonByText(container, "Save provider account")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(savedBody).toEqual({
      config: {},
      display_name: "OpenAI",
      provider_key: "openai",
      method_key: "api_key",
      secrets: { api_key: "sk-openai" },
    });
    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-preset"]'),
    ).not.toBeNull();

    cleanup(root, container);
  });

  it("preserves a custom display name across onboarding provider filter changes", async () => {
    stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();

    http.providerConfig.listRegistry = vi.fn(async () => ({
      status: "ok" as const,
      providers: [
        createRegistryProvider("302ai", "302.AI"),
        createRegistryProvider("openai", "OpenAI"),
      ],
    }));
    statusGet.mockResolvedValue(
      buildIssueStatusResponse([
        {
          code: "no_provider_accounts",
          severity: "error",
          message: "No active provider accounts are configured.",
          target: { kind: "deployment", id: null },
        },
      ]),
    );

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("baseline"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });
    core.elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    stubAdminHttpFetch(core);

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      await Promise.resolve();
    });

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-provider"]');
    const filterInput = container.querySelector<HTMLInputElement>(
      '[data-testid="providers-filter-input"]',
    );
    const displayNameInput = getInputByLabel(container, "Display name");

    expect(filterInput).not.toBeNull();
    expect(displayNameInput).not.toBeNull();

    await act(async () => {
      setControlledInputValue(displayNameInput!, "Team account");
      setControlledInputValue(filterInput!, "open");
      await Promise.resolve();
    });

    const openaiOption = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="providers-provider-option-openai"]',
    );
    expect(openaiOption.getAttribute("aria-checked")).toBe("true");
    expect(displayNameInput?.value).toBe("Team account");

    await act(async () => {
      setControlledInputValue(filterInput!, "zzz");
      await Promise.resolve();
    });

    expect(displayNameInput?.value).toBe("Team account");

    await act(async () => {
      setControlledInputValue(filterInput!, "");
      await Promise.resolve();
    });

    const threeOhTwoOption = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="providers-provider-option-302ai"]',
    );
    expect(threeOhTwoOption.getAttribute("aria-checked")).toBe("true");
    expect(displayNameInput?.value).toBe("Team account");

    cleanup(root, container);
  });
}
