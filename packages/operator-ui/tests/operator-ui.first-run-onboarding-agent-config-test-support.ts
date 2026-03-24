import { AgentConfig } from "@tyrum/contracts";
import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import {
  TEST_DEVICE_IDENTITY,
  requestInfoToUrl,
  stubPersistentStorage,
  waitForSelector,
} from "./operator-ui.test-support.js";
import { createFakeHttpClient, FakeWsClient } from "./operator-ui.test-fixtures.js";
import { stubAdminHttpFetch } from "./admin-http-fetch-test-support.js";
import {
  advanceOnboardingIntro,
  buildIssueStatusResponse,
  cleanup,
  createAgentConfigResponse,
  createConfiguredProviderGroup,
  findButtonByText,
  getInputByLabel,
  setInputByLabel,
} from "./operator-ui.first-run-onboarding.helpers.js";

export function registerFirstRunOnboardingAgentConfigTests(): void {
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
    stubAdminHttpFetch(core, async (input) => {
      const url = requestInfoToUrl(input);
      if (!url.endsWith("/config/providers/accounts")) {
        throw new Error(`Unexpected fetch call: ${url}`);
      }
      return new Response(
        JSON.stringify({ error: "provider_create_failed", message: "invalid api key" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
      await Promise.resolve();
    });

    await advanceOnboardingIntro(container);
    await waitForSelector(container, '[data-testid="first-run-onboarding-step-provider"]');
    setInputByLabel(container, "API key", "bad-key");
    setInputByLabel(container, "Display name", "OpenAI");
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

  it("saves the primary agent configuration when the resolved persona is outside config.persona", async () => {
    stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet, agentConfigGet } = createFakeHttpClient();
    let primaryAgentKey = "default";
    let agentConfigResponse = {
      ...createAgentConfigResponse({
        agentKey: primaryAgentKey,
        modelRef: null,
        tone: "warm",
      }),
      config: AgentConfig.parse({
        model: { model: null },
      }),
    };
    statusGet.mockResolvedValue(
      buildIssueStatusResponse([
        {
          code: "agent_model_unconfigured",
          severity: "error",
          message: "Agent 'default' has no primary model configured.",
          target: { kind: "agent", id: primaryAgentKey },
        },
      ]),
    );
    http.providerConfig.listProviders = vi.fn(async () => ({
      status: "ok" as const,
      providers: [createConfiguredProviderGroup()],
    }));
    http.modelConfig.listPresets = vi.fn(async () => ({
      status: "ok" as const,
      presets: [
        {
          preset_id: "00000000-0000-4000-8000-000000000301",
          preset_key: "preset-openai",
          display_name: "OpenAI Default",
          provider_key: "openai",
          model_id: "gpt-4.1",
          options: {},
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
      ],
    }));
    http.agents.list = vi.fn(
      async () => ({ agents: [{ agent_key: primaryAgentKey, is_primary: true }] }) as const,
    );
    agentConfigGet.mockImplementation(async () => agentConfigResponse);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestInfoToUrl(input);
      const method = init?.method ?? "GET";

      if (method === "GET" && url.endsWith("/config/providers/registry")) {
        return new Response(JSON.stringify(await http.providerConfig.listRegistry()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url.endsWith("/config/providers")) {
        return new Response(JSON.stringify(await http.providerConfig.listProviders()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url.endsWith("/config/models/presets")) {
        return new Response(JSON.stringify(await http.modelConfig.listPresets()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url.endsWith("/config/models/presets/available")) {
        return new Response(JSON.stringify(await http.modelConfig.listAvailable()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url.endsWith("/config/models/assignments")) {
        return new Response(JSON.stringify(await http.modelConfig.listAssignments()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "GET" && url.endsWith("/agents")) {
        return new Response(
          JSON.stringify({
            agents: [
              {
                agent_id: "11111111-1111-4111-8111-111111111111",
                agent_key: primaryAgentKey,
                created_at: "2026-03-01T00:00:00.000Z",
                updated_at: "2026-03-01T00:00:00.000Z",
                has_config: true,
                has_identity: true,
                is_primary: true,
                can_delete: false,
                persona: agentConfigResponse.persona,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        method === "GET" &&
        url.endsWith(`/config/agents/${encodeURIComponent(primaryAgentKey)}`)
      ) {
        return new Response(JSON.stringify(agentConfigResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (
        method === "POST" &&
        url.endsWith(`/agents/${encodeURIComponent(primaryAgentKey)}/rename`)
      ) {
        const body = JSON.parse(String(init?.body)) as {
          agent_key: string;
          reason?: string;
        };
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer test-elevated-token");
        expect(body.agent_key).toBe("research-agent");
        expect(body.reason).toBe("onboarding: rename primary agent");
        primaryAgentKey = body.agent_key;
        agentConfigResponse = {
          ...agentConfigResponse,
          agent_key: primaryAgentKey,
        };
        return new Response(
          JSON.stringify({
            agent_key: primaryAgentKey,
            agent_id: "11111111-1111-4111-8111-111111111111",
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
            has_config: true,
            has_identity: true,
            is_primary: true,
            can_delete: false,
            persona: agentConfigResponse.persona,
            config: agentConfigResponse.config,
            identity: {
              meta: {
                name: agentConfigResponse.persona.name,
                style: { tone: agentConfigResponse.persona.tone },
              },
            },
            config_revision: 1,
            identity_revision: 1,
            config_sha256: "a".repeat(64),
            identity_sha256: "b".repeat(64),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (method === "PUT" && url.endsWith(`/agents/${encodeURIComponent(primaryAgentKey)}`)) {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer test-elevated-token");

        const body = JSON.parse(String(init?.body)) as {
          config: { model: { model: string | null }; persona: { name: string; tone: string } };
          reason?: string;
        };
        expect(body.config.model.model).toBe("openai/gpt-4.1");
        expect(body.config.persona.name).toBe("Research Agent");
        expect(body.config.persona.tone).toBe("warm");
        expect(body.reason).toBe("onboarding: configure primary agent");

        agentConfigResponse = createAgentConfigResponse({
          agentKey: primaryAgentKey,
          modelRef: "openai/gpt-4.1",
          name: "Research Agent",
          tone: "warm",
        });
        return new Response(
          JSON.stringify({
            agent_id: "11111111-1111-4111-8111-111111111111",
            agent_key: primaryAgentKey,
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-02T00:00:00.000Z",
            has_config: true,
            has_identity: true,
            is_primary: true,
            can_delete: false,
            persona: agentConfigResponse.persona,
            config: agentConfigResponse.config,
            identity: {
              meta: {
                name: agentConfigResponse.persona.name,
                style: { tone: agentConfigResponse.persona.tone },
              },
            },
            config_revision: 1,
            identity_revision: 1,
            config_sha256: "a".repeat(64),
            identity_sha256: "b".repeat(64),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
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

    await advanceOnboardingIntro(container);
    await waitForSelector(container, '[data-testid="first-run-onboarding-step-agent"]', 200);
    const agentNameInput = getInputByLabel(container, "Agent name");
    expect(agentNameInput).not.toBeNull();
    expect(agentNameInput?.value).not.toBe("");
    expect(agentNameInput?.value).not.toBe("Default Agent");
    setInputByLabel(container, "Agent name", "Euclid");
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Randomize agent name"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(agentNameInput?.value).not.toBe("Euclid");
    setInputByLabel(container, "Agent name", "Research Agent");
    const toneSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="first-run-onboarding-step-agent"] select',
    );
    expect(toneSelect?.value).toBe("warm");

    const saveButton = findButtonByText(container, "Save agent");
    expect(saveButton).not.toBeNull();
    expect(saveButton?.disabled).toBe(false);
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const mutationCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init?.method ?? "GET") !== "GET",
    );
    expect(mutationCalls).toHaveLength(2);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        requestInfoToUrl(input).includes(
          `/config/policy/agents/${encodeURIComponent(primaryAgentKey)}`,
        ),
      ),
    ).toBe(false);

    cleanup(root, container);
  });
}
