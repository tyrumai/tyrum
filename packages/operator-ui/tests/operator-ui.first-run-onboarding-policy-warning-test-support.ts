import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import {
  TEST_DEVICE_IDENTITY,
  requestInfoToUrl,
  stubPersistentStorage,
  waitForSelector,
} from "./operator-ui.test-support.js";
import { createFakeHttpClient, FakeWsClient } from "./operator-ui.test-fixtures.js";
import {
  buildIssueStatusResponse,
  cleanup,
  createAgentConfigResponse,
  createConfiguredProviderGroup,
  findButtonByText,
  setInputByLabel,
} from "./operator-ui.first-run-onboarding.helpers.js";

export function registerFirstRunOnboardingPolicyWarningTests(): void {
  it("shows a warning instead of a fatal error when the agent policy route is unavailable", async () => {
    const toastWarningMock = vi.spyOn(toast, "warning").mockImplementation(() => "");
    stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet, agentConfigGet } = createFakeHttpClient();
    let primaryAgentKey = "default";
    let agentConfigResponse = createAgentConfigResponse({
      agentKey: primaryAgentKey,
      modelRef: null,
    });
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
        const body = JSON.parse(String(init?.body)) as { agent_key: string };
        primaryAgentKey = body.agent_key;
        agentConfigResponse = { ...agentConfigResponse, agent_key: primaryAgentKey };
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
        const body = JSON.parse(String(init?.body)) as {
          config: { model: { model: string | null }; persona: { name: string; tone: string } };
        };
        agentConfigResponse = createAgentConfigResponse({
          agentKey: primaryAgentKey,
          modelRef: body.config.model.model,
          name: body.config.persona.name,
          tone: body.config.persona.tone,
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
      if (
        method === "PUT" &&
        url.endsWith(`/config/policy/agents/${encodeURIComponent(primaryAgentKey)}`)
      ) {
        return new Response(JSON.stringify({ error: "not_found", message: "route not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
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

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-agent"]', 200);
    setInputByLabel(container, "Agent name", "Research Agent");

    const saveButton = findButtonByText(container, "Save agent");
    expect(saveButton).not.toBeNull();
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Unable to save onboarding step");
    expect(toastWarningMock).toHaveBeenCalledWith("Agent created with limited setup", {
      description:
        "HTTP request failed. The agent was configured, but the policy preset was not applied.",
    });

    cleanup(root, container);
  });
}
