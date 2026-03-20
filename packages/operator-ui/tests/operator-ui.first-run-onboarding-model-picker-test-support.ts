import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import { stubAdminHttpFetch } from "./admin-http-fetch-test-support.js";
import {
  EXECUTION_PROFILE_IDS,
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

export function registerFirstRunOnboardingModelPickerTests(): void {
  it("filters models, auto-selects Claude, and saves the visible model selection", async () => {
    stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();
    const providers = [createConfiguredProviderGroup()];
    let presets: Array<{
      preset_id: string;
      preset_key: string;
      display_name: string;
      provider_key: string;
      model_id: string;
      options: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }> = [];
    let savedBody: {
      display_name: string;
      provider_key: string;
      model_id: string;
      options: Record<string, string>;
    } | null = null;

    http.providerConfig.listRegistry = vi.fn(async () => ({
      status: "ok" as const,
      providers: [
        createRegistryProvider("openai", "OpenAI"),
        createRegistryProvider("anthropic", "Anthropic"),
      ],
    }));
    http.providerConfig.listProviders = vi.fn(async () => ({
      status: "ok" as const,
      providers,
    }));
    http.modelConfig.listPresets = vi.fn(async () => ({
      status: "ok" as const,
      presets,
    }));
    http.modelConfig.listAvailable = vi.fn(async () => ({
      status: "ok" as const,
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
        {
          provider_key: "anthropic",
          provider_name: "Anthropic",
          model_id: "claude-3.7-sonnet",
          model_name: "Claude 3.7 Sonnet",
          family: "Claude",
          reasoning: true,
          tool_call: true,
          modalities: { output: ["text"] },
        },
      ],
    }));

    statusGet.mockImplementation(async () => {
      if (presets.length === 0) {
        return buildIssueStatusResponse([
          {
            code: "no_model_presets",
            severity: "error",
            message: "No model presets are configured.",
            target: { kind: "deployment", id: null },
          },
        ]);
      }

      return buildIssueStatusResponse([
        {
          code: "agent_model_unconfigured",
          severity: "error",
          message: "Agent setup still needs configuration.",
          target: { kind: "agent", id: "default" },
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
      if (url.endsWith("/config/models/assignments")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            assignments: EXECUTION_PROFILE_IDS.map((execution_profile_id) => ({
              execution_profile_id,
              preset_key: presets[0]?.preset_key ?? null,
              preset_display_name: presets[0]?.display_name ?? null,
              provider_key: presets[0]?.provider_key ?? null,
              model_id: presets[0]?.model_id ?? null,
            })),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (!url.endsWith("/config/models/presets")) {
        throw new Error(`Unexpected fetch call: ${url}`);
      }

      savedBody = JSON.parse(String(init?.body)) as typeof savedBody;
      presets = [
        {
          preset_id: "00000000-0000-4000-8000-000000000301",
          preset_key: "preset-claude-3-7-sonnet",
          display_name: savedBody!.display_name,
          provider_key: savedBody!.provider_key,
          model_id: savedBody!.model_id,
          options: savedBody!.options,
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
      ];

      return new Response(JSON.stringify({ status: "ok", preset: presets[0] }), {
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

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-preset"]');
    const filterInput = container.querySelector<HTMLInputElement>(
      '[data-testid="models-filter-input"]',
    );
    const displayNameInput = getInputByLabel(container, "Display name");

    expect(filterInput).not.toBeNull();
    expect(displayNameInput).not.toBeNull();
    expect(displayNameInput?.value).toBe("GPT-4.1");

    await act(async () => {
      setControlledInputValue(filterInput!, "claude");
      await Promise.resolve();
    });

    const claudeOption = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="models-model-option-anthropic/claude-3.7-sonnet"]',
    );
    expect(
      container.querySelector('[data-testid="models-model-option-openai/gpt-4.1"]'),
    ).toBeNull();
    expect(claudeOption.getAttribute("aria-checked")).toBe("true");
    expect(displayNameInput?.value).toBe("Claude 3.7 Sonnet");

    await act(async () => {
      findButtonByText(container, "Save model preset")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(savedBody).toEqual({
      display_name: "Claude 3.7 Sonnet",
      provider_key: "anthropic",
      model_id: "claude-3.7-sonnet",
      options: {},
    });
    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-agent"]', 200),
    ).not.toBeNull();

    cleanup(root, container);
  });

  it("preserves a custom display name across onboarding model filter changes", async () => {
    stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();

    http.providerConfig.listRegistry = vi.fn(async () => ({
      status: "ok" as const,
      providers: [createRegistryProvider("openai", "OpenAI")],
    }));
    http.providerConfig.listProviders = vi.fn(async () => ({
      status: "ok" as const,
      providers: [createConfiguredProviderGroup()],
    }));
    http.modelConfig.listPresets = vi.fn(async () => ({ status: "ok" as const, presets: [] }));
    http.modelConfig.listAvailable = vi.fn(async () => ({
      status: "ok" as const,
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
        {
          provider_key: "openai",
          provider_name: "OpenAI",
          model_id: "gpt-4.1-mini",
          model_name: "GPT-4.1 Mini",
          family: null,
          reasoning: true,
          tool_call: true,
          modalities: { output: ["text"] },
        },
      ],
    }));
    statusGet.mockResolvedValue(
      buildIssueStatusResponse([
        {
          code: "no_model_presets",
          severity: "error",
          message: "No model presets are configured.",
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

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-preset"]');
    const filterInput = container.querySelector<HTMLInputElement>(
      '[data-testid="models-filter-input"]',
    );
    const displayNameInput = getInputByLabel(container, "Display name");

    expect(filterInput).not.toBeNull();
    expect(displayNameInput).not.toBeNull();

    await act(async () => {
      setControlledInputValue(displayNameInput!, "Team preset");
      setControlledInputValue(filterInput!, "mini");
      await Promise.resolve();
    });

    const miniOption = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="models-model-option-openai/gpt-4.1-mini"]',
    );
    expect(miniOption.getAttribute("aria-checked")).toBe("true");
    expect(displayNameInput?.value).toBe("Team preset");

    await act(async () => {
      setControlledInputValue(filterInput!, "zzz");
      await Promise.resolve();
    });

    expect(displayNameInput?.value).toBe("Team preset");

    await act(async () => {
      setControlledInputValue(filterInput!, "");
      await Promise.resolve();
    });

    const defaultOption = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="models-model-option-openai/gpt-4.1"]',
    );
    expect(defaultOption.getAttribute("aria-checked")).toBe("true");
    expect(displayNameInput?.value).toBe("Team preset");

    cleanup(root, container);
  });
}
