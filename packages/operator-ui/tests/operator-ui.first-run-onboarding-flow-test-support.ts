import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import {
  TEST_DEVICE_IDENTITY,
  requestInfoToUrl,
  stubPersistentStorage,
  waitForSelector,
} from "./operator-ui.test-support.js";
import {
  FakeWsClient,
  createFakeHttpClient,
  sampleStatusResponse,
} from "./operator-ui.test-fixtures.js";
import {
  buildIssueStatusResponse,
  cleanup,
  createActiveProviderGroup,
  createAgentConfigResponse,
  findButtonByText,
  setInputByLabel,
  unassignedAssignments,
} from "./operator-ui.first-run-onboarding.helpers.js";

export function registerFirstRunOnboardingFlowTests(): void {
  it("progresses through provider, preset, assignments, and default-agent steps to completion", async () => {
    const { local } = stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();
    let providers: ReturnType<typeof createActiveProviderGroup>[] = [];
    let presets: Array<{
      preset_id: string;
      preset_key: string;
      display_name: string;
      provider_key: string;
      model_id: string;
      options: Record<string, string>;
      created_at: string;
      updated_at: string;
    }> = [];
    let assignments = unassignedAssignments();
    let agentConfig = createAgentConfigResponse(null);

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
      if (assignments.some((assignment) => assignment.preset_key === null)) {
        return buildIssueStatusResponse([
          {
            code: "execution_profile_unassigned",
            severity: "error",
            message: "Execution profile is unassigned.",
            target: { kind: "execution_profile", id: "interaction" },
          },
        ]);
      }
      if (agentConfig.config.model.model === null) {
        return buildIssueStatusResponse([
          {
            code: "agent_model_unconfigured",
            severity: "error",
            message: "Agent 'default' has no primary model configured.",
            target: { kind: "agent", id: "default" },
          },
        ]);
      }
      return sampleStatusResponse();
    });

    http.providerConfig.listProviders = vi.fn(async () => ({
      status: "ok" as const,
      providers,
    }));
    http.modelConfig.listPresets = vi.fn(async () => ({ status: "ok" as const, presets }));
    http.modelConfig.listAssignments = vi.fn(async () => ({ status: "ok" as const, assignments }));
    http.agentConfig.get = vi.fn(async () => agentConfig);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestInfoToUrl(input);
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-elevated-token");

      if (url.endsWith("/config/providers/accounts")) {
        const body = JSON.parse(String(init?.body)) as {
          display_name: string;
          provider_key: string;
          method_key: string;
        };
        const providerGroup = createActiveProviderGroup();
        providers = [
          {
            ...providerGroup,
            accounts: [
              {
                ...providerGroup.accounts[0],
                display_name: body.display_name,
                provider_key: body.provider_key,
                method_key: body.method_key,
              },
            ],
          },
        ];
        return new Response(JSON.stringify({ status: "ok", account: providers[0]!.accounts[0] }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.endsWith("/config/models/presets")) {
        const body = JSON.parse(String(init?.body)) as {
          display_name: string;
          provider_key: string;
          model_id: string;
          options: Record<string, string>;
        };
        const preset = {
          preset_id: "99999999-9999-4999-8999-999999999999",
          preset_key: "preset-onboarding",
          display_name: body.display_name,
          provider_key: body.provider_key,
          model_id: body.model_id,
          options: body.options,
          created_at: "2026-03-02T00:00:00.000Z",
          updated_at: "2026-03-02T00:00:00.000Z",
        };
        presets = [preset];
        return new Response(JSON.stringify({ status: "ok", preset }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.endsWith("/config/models/assignments")) {
        const body = JSON.parse(String(init?.body)) as {
          assignments: Record<string, string | null>;
        };
        assignments = Object.entries(body.assignments).map(
          ([execution_profile_id, preset_key]) => ({
            execution_profile_id,
            preset_key,
            preset_display_name: presets[0]?.display_name ?? null,
            provider_key: presets[0]?.provider_key ?? null,
            model_id: presets[0]?.model_id ?? null,
          }),
        );
        return new Response(JSON.stringify({ status: "ok", assignments }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.endsWith("/config/agents/default")) {
        const body = JSON.parse(String(init?.body)) as {
          config: typeof agentConfig.config;
          reason?: string;
        };
        agentConfig = {
          ...createAgentConfigResponse(body.config.model.model),
          config: body.config,
          reason: body.reason ?? null,
        };
        return new Response(JSON.stringify(agentConfig), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

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

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      await Promise.resolve();
    });

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-provider"]');
    setInputByLabel(container, "API key", "secret-key");
    await act(async () => {
      findButtonByText(container, "Save provider account")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-preset"]');
    setInputByLabel(container, "Display name", "Onboarding Default");
    await act(async () => {
      findButtonByText(container, "Save model preset")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-assignments"]');
    await act(async () => {
      findButtonByText(container, "Save assignments")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-agent"]');
    await act(async () => {
      findButtonByText(container, "Save default agent")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-done"]'),
    ).not.toBeNull();
    expect(local.size).toBe(0);

    cleanup(root, container);
  });

  it("keeps the provider step open and shows an error when saving fails", async () => {
    stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestInfoToUrl(input);
        if (!url.endsWith("/config/providers/accounts")) {
          throw new Error(`Unexpected fetch call: ${url}`);
        }
        return new Response(
          JSON.stringify({ error: "provider_create_failed", message: "invalid api key" }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch,
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

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      await Promise.resolve();
    });

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-provider"]');
    setInputByLabel(container, "API key", "bad-key");
    await act(async () => {
      findButtonByText(container, "Save provider account")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("invalid api key");
    expect(
      container.querySelector('[data-testid="first-run-onboarding-step-provider"]'),
    ).not.toBeNull();

    cleanup(root, container);
  });

  it("saves the default agent model through elevated admin http", async () => {
    stubPersistentStorage();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestInfoToUrl(input);
      if (!url.endsWith("/config/agents/default")) {
        throw new Error(`Unexpected fetch call: ${url}`);
      }

      const headers = new Headers(init?.headers);
      expect(init?.method).toBe("PUT");
      expect(headers.get("authorization")).toBe("Bearer test-elevated-token");

      const body = JSON.parse(String(init?.body)) as {
        config: { model: { model: string | null } };
        reason?: string;
      };
      expect(body.config.model.model).toBe("openai/gpt-4.1");
      expect(body.reason).toBe("onboarding: set default agent primary model");

      return new Response(JSON.stringify(createAgentConfigResponse("openai/gpt-4.1")), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const ws = new FakeWsClient();
    const { http, statusGet, agentConfigGet } = createFakeHttpClient();
    statusGet.mockResolvedValue(
      buildIssueStatusResponse([
        {
          code: "agent_model_unconfigured",
          severity: "error",
          message: "Agent 'default' has no primary model configured.",
          target: { kind: "agent", id: "default" },
        },
      ]),
    );
    http.providerConfig.listProviders = vi.fn(async () => ({
      status: "ok" as const,
      providers: [createActiveProviderGroup()],
    }));
    agentConfigGet.mockResolvedValue(createAgentConfigResponse(null));

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

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      await Promise.resolve();
    });

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-agent"]');

    const saveButton = findButtonByText(container, "Save default agent");
    expect(saveButton).not.toBeNull();
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    cleanup(root, container);
  });
}
