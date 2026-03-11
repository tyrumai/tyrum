import React, { act } from "react";
import { vi } from "vitest";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createElevatedModeStore } from "../../../operator-core/src/stores/elevated-mode-store.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { ThemeProvider } from "../../src/hooks/use-theme.js";
import { renderIntoDocument, type TestRoot } from "../test-utils.js";

const EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;

export async function switchAdminTab(container: HTMLElement, testId: string): Promise<void> {
  const tab = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!tab) {
    throw new Error(`Missing admin tab ${testId}`);
  }
  await act(async () => {
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
}

export function renderStrictAdminConfigurePage(core: OperatorCore): TestRoot {
  return renderIntoDocument(
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
}

export function createPanelsCore(activeAdminMode: boolean): { core: OperatorCore } {
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
        getBundle: vi.fn(
          async () =>
            ({
              status: "ok",
              generated_at: "2026-03-01T00:00:00.000Z",
              effective: {
                sha256: "policy-sha-1",
                bundle: {
                  v: 1,
                  tools: {
                    default: "require_approval",
                    allow: ["read"],
                    require_approval: [],
                    deny: [],
                  },
                  network_egress: {
                    default: "require_approval",
                    allow: [],
                    require_approval: [],
                    deny: [],
                  },
                  secrets: {
                    default: "require_approval",
                    allow: [],
                    require_approval: [],
                    deny: [],
                  },
                  connectors: {
                    default: "require_approval",
                    allow: ["telegram:*"],
                    require_approval: [],
                    deny: [],
                  },
                  artifacts: { default: "allow" },
                  provenance: { untrusted_shell_requires_approval: true },
                },
                sources: { deployment: "default", agent: null, playbook: null },
              },
            }) as unknown,
        ),
        listOverrides: vi.fn(async () => ({ status: "ok", overrides: [] })),
        createOverride: vi.fn(async () => ({ status: "ok" })),
        revokeOverride: vi.fn(async () => ({ status: "ok" })),
      },
      policyConfig: {
        getDeployment: vi.fn(async () => ({
          revision: 1,
          agent_key: null,
          bundle: {
            v: 1,
            tools: { default: "require_approval", allow: ["read"], require_approval: [], deny: [] },
          },
          created_at: "2026-03-01T00:00:00.000Z",
          created_by: { kind: "tenant.token", token_id: "token-1" },
          reason: "seed",
          reverted_from_revision: null,
        })),
        listDeploymentRevisions: vi.fn(async () => ({
          revisions: [
            {
              revision: 1,
              agent_key: null,
              created_at: "2026-03-01T00:00:00.000Z",
              created_by: { kind: "tenant.token", token_id: "token-1" },
              reason: "seed",
              reverted_from_revision: null,
            },
          ],
        })),
        updateDeployment: vi.fn(async (input: { bundle: unknown; reason?: string }) => ({
          revision: 2,
          agent_key: null,
          bundle: input.bundle,
          created_at: "2026-03-01T00:00:00.000Z",
          created_by: { kind: "tenant.token", token_id: "token-1" },
          reason: input.reason,
          reverted_from_revision: null,
        })),
        revertDeployment: vi.fn(async (input: { revision: number; reason?: string }) => ({
          revision: 3,
          agent_key: null,
          bundle: {
            v: 1,
            tools: {
              default: "require_approval",
              allow: ["read"],
              require_approval: [],
              deny: [],
            },
          },
          created_at: "2026-03-01T00:00:00.000Z",
          created_by: { kind: "tenant.token", token_id: "token-1" },
          reason: input.reason,
          reverted_from_revision: input.revision,
        })),
      },
      agents: {
        list: vi.fn(async () => ({
          agents: [
            {
              agent_id: "00000000-0000-4000-8000-000000000002",
              agent_key: "default",
              created_at: "2026-03-01T00:00:00.000Z",
              updated_at: "2026-03-01T00:00:00.000Z",
              has_config: true,
              has_identity: true,
              can_delete: false,
              persona: {
                name: "Default Agent",
                description: "Primary operator",
                tone: "Direct",
                palette: "neutral",
                character: "operator",
              },
            },
          ],
        })),
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
