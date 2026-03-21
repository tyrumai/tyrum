import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import { stubAdminHttpFetch } from "./admin-http-fetch-test-support.js";
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
  advanceOnboardingIntro,
  buildIssueStatusResponse,
  cleanup,
  createAgentConfigResponse,
  createConfiguredProviderGroup,
  findButtonByText,
  setInputByLabel,
  unassignedAssignments,
} from "./operator-ui.first-run-onboarding.helpers.js";

export function registerFirstRunOnboardingFlowTests(): void {
  it("progresses through provider, preset, workspace policy, and agent setup to completion", async () => {
    const { local } = stubPersistentStorage();
    const ws = new FakeWsClient();
    const { http, statusGet } = createFakeHttpClient();
    let providers: ReturnType<typeof createConfiguredProviderGroup>[] = [];
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
    let workspacePolicyConfigured = false;
    let primaryAgentKey = "default";
    let agentConfig = createAgentConfigResponse({ agentKey: primaryAgentKey, modelRef: null });
    http.agents.list = vi.fn(
      async () =>
        ({
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
              persona: agentConfig.persona,
            },
          ],
        }) as const,
    );

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
      if (!workspacePolicyConfigured) {
        return buildIssueStatusResponse([
          {
            code: "workspace_policy_unconfigured",
            severity: "warning",
            message: "Workspace policy has not been configured.",
            target: { kind: "deployment", id: null },
          },
        ]);
      }
      if (agentConfig.config.model.model === null) {
        return buildIssueStatusResponse([
          {
            code: "agent_model_unconfigured",
            severity: "error",
            message: `Agent '${primaryAgentKey}' has no primary model configured.`,
            target: { kind: "agent", id: primaryAgentKey },
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
    http.agentConfig.get = vi.fn(async (agentKey: string) => {
      expect(agentKey).toBe(primaryAgentKey);
      return agentConfig;
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

    const { writeSpy: fetchMock } = stubAdminHttpFetch(core, async (input, init) => {
      const url = requestInfoToUrl(input);
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-elevated-token");

      if (url.endsWith("/config/providers/accounts")) {
        const body = JSON.parse(String(init?.body)) as {
          display_name: string;
          provider_key: string;
          method_key: string;
        };
        const providerGroup = createConfiguredProviderGroup();
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

      if (url.endsWith("/config/policy/deployment")) {
        const body = JSON.parse(String(init?.body)) as {
          bundle: { v: number };
          reason?: string;
        };
        expect(body.bundle.v).toBe(1);
        expect(body.reason).toBe("onboarding: configure workspace policy");
        workspacePolicyConfigured = true;
        return new Response(
          JSON.stringify({
            revision: 1,
            bundle: body.bundle,
            agent_key: null,
            created_at: "2026-03-02T00:00:00.000Z",
            created_by: { kind: "tenant.token", token_id: "token-1" },
            reason: body.reason ?? null,
            reverted_from_revision: null,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.endsWith(`/agents/${encodeURIComponent(primaryAgentKey)}/rename`)) {
        const body = JSON.parse(String(init?.body)) as {
          agent_key: string;
          reason?: string;
        };
        primaryAgentKey = body.agent_key;
        agentConfig = {
          ...agentConfig,
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
            persona: agentConfig.persona,
            config: agentConfig.config,
            identity: {
              meta: {
                name: agentConfig.persona.name,
                style: { tone: agentConfig.persona.tone },
              },
            },
            config_revision: 1,
            identity_revision: 1,
            config_sha256: "a".repeat(64),
            identity_sha256: "b".repeat(64),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.endsWith(`/agents/${encodeURIComponent(primaryAgentKey)}`)) {
        const body = JSON.parse(String(init?.body)) as {
          config: typeof agentConfig.config;
          reason?: string;
        };
        agentConfig = createAgentConfigResponse({
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
            persona: agentConfig.persona,
            config: agentConfig.config,
            identity: {
              meta: {
                name: agentConfig.persona.name,
                style: { tone: agentConfig.persona.tone },
              },
            },
            config_revision: 1,
            identity_revision: 1,
            config_sha256: "a".repeat(64),
            identity_sha256: "b".repeat(64),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      throw new Error(`Unexpected fetch call: ${url}`);
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
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-palette"]')
        ?.getAttribute("data-status"),
    ).toBe("done");
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-admin"]')
        ?.getAttribute("data-status"),
    ).toBe("done");
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-provider"]')
        ?.getAttribute("data-status"),
    ).toBe("current");
    setInputByLabel(container, "API key", "secret-key");
    setInputByLabel(container, "Display name", "OpenAI");
    await act(async () => {
      findButtonByText(container, "Save provider account")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-preset"]', 200);
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-provider"]')
        ?.getAttribute("data-status"),
    ).toBe("done");
    expect(
      container
        .querySelector('[data-testid="first-run-onboarding-progress-preset"]')
        ?.getAttribute("data-status"),
    ).toBe("current");
    setInputByLabel(container, "Display name", "Onboarding Default");
    await act(async () => {
      findButtonByText(container, "Save model preset")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await waitForSelector(
      container,
      '[data-testid="first-run-onboarding-step-workspace-policy"]',
      200,
    );
    await act(async () => {
      findButtonByText(container, "Save workspace policy")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await waitForSelector(container, '[data-testid="first-run-onboarding-step-agent"]', 200);
    setInputByLabel(container, "Agent name", "Operations Agent");
    await act(async () => {
      findButtonByText(container, "Save agent")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(
      await waitForSelector(container, '[data-testid="first-run-onboarding-step-done"]', 200),
    ).not.toBeNull();
    expect(primaryAgentKey).toBe("operations-agent");
    expect(Array.from(local.values())).toContainEqual(
      expect.stringContaining('"status":"completed"'),
    );

    cleanup(root, container);
  });
}
