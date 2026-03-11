import React, { act } from "react";
import { expect, vi } from "vitest";
import { TyrumHttpClientError } from "@tyrum/client/browser";
import { createElevatedModeStore, type OperatorCore } from "../../../operator-core/src/index.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import { cleanupTestRoot, renderIntoDocument, type TestRoot } from "../test-utils.js";
import {
  ADMIN_HTTP_EXECUTION_PROFILE_IDS,
  TEST_TIMESTAMP,
  createAssignmentsForAllProfiles,
  createAvailableModel,
  createModelAssignment,
  createModelPreset,
  createUnassignedAssignmentsForAllProfiles,
  type AvailableModelFixture,
  type ExecutionProfileId,
  type ModelAssignmentFixture,
  type ModelPresetFixture,
} from "./admin-page.http-fixture-support.js";

export {
  ADMIN_HTTP_EXECUTION_PROFILE_IDS,
  TEST_TIMESTAMP,
  createAssignmentsForAllProfiles,
  createAvailableModel,
  createModelAssignment,
  createModelPreset,
  createUnassignedAssignmentsForAllProfiles,
  type AvailableModelFixture,
  type ExecutionProfileId,
  type ModelAssignmentFixture,
  type ModelPresetFixture,
} from "./admin-page.http-fixture-support.js";

type ModelConfigMocks = {
  listPresets: ReturnType<typeof vi.fn>;
  listAvailable: ReturnType<typeof vi.fn>;
  listAssignments: ReturnType<typeof vi.fn>;
};

type ModelsFetchStubInput = {
  presets: ModelPresetFixture[] | (() => ModelPresetFixture[]);
  models: AvailableModelFixture[] | (() => AvailableModelFixture[]);
  assignments: ModelAssignmentFixture[] | (() => ModelAssignmentFixture[]);
  createPreset?: {
    expectedBody: unknown;
    responsePreset: ModelPresetFixture;
    afterCreate?: () => void;
  };
  updatePreset?: {
    presetKey: string;
    expectedBody: unknown;
    responsePreset: ModelPresetFixture | (() => ModelPresetFixture);
    afterUpdate?: () => void;
  };
  updateAssignments?: {
    expectedBody: unknown;
    responseAssignments: ModelAssignmentFixture[] | (() => ModelAssignmentFixture[]);
    afterUpdate?: () => void;
  };
  deletePreset?: {
    presetKey: string;
    handle: (body: unknown, attempt: number) => Response | Promise<Response>;
  };
};

function resolveValue<T>(value: T | (() => T)): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function findLabeledElement<T extends Element>(
  root: ParentNode,
  selector: "input" | "select",
  labelPrefix: string,
): T | null {
  const label = Array.from(root.querySelectorAll<HTMLLabelElement>("label")).find((candidate) =>
    candidate.textContent?.trim().startsWith(labelPrefix),
  );
  return label?.htmlFor ? root.querySelector<T>(`${selector}[id="${label.htmlFor}"]`) : null;
}

export function expectPresent<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  return value as T;
}

export function getByTestId<T extends Element>(root: ParentNode, testId: string): T {
  return expectPresent(root.querySelector<T>(`[data-testid='${testId}']`));
}

export function getButton(root: ParentNode, text: string): HTMLButtonElement {
  return expectPresent(
    Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === text,
    ),
  );
}

export function getLabeledInput(root: ParentNode, labelPrefix: string): HTMLInputElement {
  return expectPresent(findLabeledElement<HTMLInputElement>(root, "input", labelPrefix));
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export function click(element: HTMLElement | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export async function clickAndFlush(element: HTMLElement | null | undefined): Promise<void> {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

export function setSelectValue(select: HTMLSelectElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set as
      | ((this: HTMLSelectElement, nextValue: string) => void)
      | undefined;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export async function switchHttpTab(
  container: HTMLElement,
  tabTestId: string,
): Promise<HTMLButtonElement> {
  const button = expectPresent(
    container.querySelector<HTMLButtonElement>(`[data-testid="${tabTestId}"]`),
  );
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
  return button;
}

export async function openModelsTab(container: HTMLElement): Promise<void> {
  await switchHttpTab(container, "admin-http-tab-models");
  await flush();
}

export function openPolicyTab(container: HTMLElement): void {
  const trigger = expectPresent(
    container.querySelector<HTMLButtonElement>("[data-testid='admin-http-tab-policy']"),
  );
  act(() => {
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export function renderAdminHttpConfigurePage(core: OperatorCore): TestRoot {
  return renderIntoDocument(
    React.createElement(ElevatedModeProvider, { core, mode: "web" }, [
      React.createElement(ConfigurePage, { key: "page", core }),
    ]),
  );
}

export function cleanupAdminHttpPage(testRoot: TestRoot): void {
  cleanupTestRoot(testRoot);
}
export function getModelConfig(core: OperatorCore): ModelConfigMocks {
  return core.http.modelConfig as ModelConfigMocks;
}

export function setModelConfigResponses(
  core: OperatorCore,
  input: {
    presets?: ModelPresetFixture[];
    models?: AvailableModelFixture[];
    assignments?: ModelAssignmentFixture[];
    listAvailableError?: Error;
    listAssignmentsError?: Error;
  },
): ModelConfigMocks {
  const modelConfig = getModelConfig(core);
  modelConfig.listPresets = vi.fn(async () => ({
    status: "ok",
    presets: input.presets ?? [],
  }));
  modelConfig.listAvailable = vi.fn(async () => {
    if (input.listAvailableError) {
      throw input.listAvailableError;
    }
    return { status: "ok", models: input.models ?? [] };
  });
  modelConfig.listAssignments = vi.fn(async () => {
    if (input.listAssignmentsError) {
      throw input.listAssignmentsError;
    }
    return { status: "ok", assignments: input.assignments ?? [] };
  });
  return modelConfig;
}

export function createAdminHttpTestCore(): {
  core: OperatorCore;
  routingConfigUpdate: ReturnType<typeof vi.fn>;
  secretsRotate: ReturnType<typeof vi.fn>;
  policyCreateOverride: ReturnType<typeof vi.fn>;
} {
  const elevatedModeStore = createElevatedModeStore({
    tickIntervalMs: 0,
    now: () => Date.parse(TEST_TIMESTAMP),
  });
  elevatedModeStore.enter({
    elevatedToken: "test-elevated-token",
    expiresAt: "2026-03-01T00:01:00.000Z",
  });

  const routingConfigUpdate = vi.fn(async () => ({ revision: 1, config: { v: 1 } }) as unknown);
  const secretsRotate = vi.fn(async () => ({ revoked: true, handle: {} }) as unknown);
  const policyCreateOverride = vi.fn(async () => ({ status: "ok" }) as unknown);

  const core = {
    httpBaseUrl: "http://example.test",
    elevatedModeStore,
    http: {
      policy: {
        getBundle: vi.fn(
          async () =>
            ({
              status: "ok",
              generated_at: TEST_TIMESTAMP,
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
                sources: {
                  deployment: "default",
                  agent: null,
                  playbook: null,
                },
              },
            }) as unknown,
        ),
        listOverrides: vi.fn(async () => ({ status: "ok", overrides: [] }) as unknown),
        createOverride: policyCreateOverride,
        revokeOverride: vi.fn(async () => ({ status: "ok" }) as unknown),
      },
      policyConfig: {
        getDeployment: vi.fn(async () => {
          throw new TyrumHttpClientError("http_error", "not found", {
            status: 404,
            error: "not_found",
          });
        }),
        listDeploymentRevisions: vi.fn(async () => ({ revisions: [] }) as unknown),
        updateDeployment: vi.fn(
          async (input: { bundle: unknown; reason?: string }) =>
            ({
              revision: 1,
              bundle: input.bundle,
              created_at: TEST_TIMESTAMP,
              created_by: { kind: "tenant.token", token_id: "token-1" },
              reason: input.reason,
              reverted_from_revision: null,
            }) as unknown,
        ),
        revertDeployment: vi.fn(
          async (input: { revision: number; reason?: string }) =>
            ({
              revision: input.revision + 1,
              bundle: {
                v: 1,
                tools: {
                  default: "require_approval",
                  allow: ["read"],
                  require_approval: [],
                  deny: [],
                },
              },
              created_at: TEST_TIMESTAMP,
              created_by: { kind: "tenant.token", token_id: "token-1" },
              reason: input.reason,
              reverted_from_revision: input.revision,
            }) as unknown,
        ),
      },
      agents: {
        list: vi.fn(
          async () =>
            ({
              agents: [
                {
                  agent_id: "00000000-0000-4000-8000-000000000002",
                  agent_key: "default",
                  created_at: TEST_TIMESTAMP,
                  updated_at: TEST_TIMESTAMP,
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
            }) as unknown,
        ),
      },
      authProfiles: {
        list: vi.fn(async () => ({ status: "ok", profiles: [] }) as unknown),
        create: vi.fn(async () => ({ status: "ok" }) as unknown),
        update: vi.fn(async () => ({ status: "ok" }) as unknown),
        disable: vi.fn(async () => ({ status: "ok" }) as unknown),
        enable: vi.fn(async () => ({ status: "ok" }) as unknown),
      },
      authPins: {
        list: vi.fn(async () => ({ status: "ok", pins: [] }) as unknown),
        set: vi.fn(async () => ({ status: "ok" }) as unknown),
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
        listProviders: vi.fn(async () => ({ status: "ok", providers: [] }) as unknown),
        createAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
        updateAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
        deleteAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
        deleteProvider: vi.fn(async () => ({ status: "ok" }) as unknown),
      },
      routingConfig: {
        get: vi.fn(async () => ({ revision: 0, config: { v: 1 } }) as unknown),
        update: routingConfigUpdate,
        revert: vi.fn(async () => ({ revision: 0, config: { v: 1 } }) as unknown),
      },
      toolRegistry: {
        list: vi.fn(
          async () =>
            ({
              status: "ok",
              tools: [
                {
                  source: "builtin",
                  canonical_id: "read",
                  description: "Read files from disk.",
                  risk: "low",
                  requires_confirmation: false,
                  effective_exposure: {
                    enabled: true,
                    reason: "enabled",
                    agent_key: "default",
                  },
                  keywords: ["read", "file"],
                },
                {
                  source: "builtin_mcp",
                  canonical_id: "websearch",
                  description: "Search the web via Exa.",
                  risk: "medium",
                  requires_confirmation: true,
                  effective_exposure: {
                    enabled: true,
                    reason: "enabled",
                    agent_key: "default",
                  },
                  backing_server: {
                    id: "exa",
                    name: "Exa",
                    transport: "remote",
                    url: "https://mcp.exa.ai/mcp",
                  },
                },
                {
                  source: "plugin",
                  canonical_id: "plugin.echo.say",
                  description: "Echo text back to the caller.",
                  risk: "low",
                  requires_confirmation: false,
                  effective_exposure: {
                    enabled: false,
                    reason: "disabled_by_agent_allowlist",
                    agent_key: "default",
                  },
                  plugin: {
                    id: "echo",
                    name: "Echo",
                    version: "0.0.1",
                  },
                },
              ],
            }) as unknown,
        ),
      },
      secrets: {
        store: vi.fn(async () => ({ handle: {} }) as unknown),
        list: vi.fn(async () => ({ handles: [] }) as unknown),
        rotate: secretsRotate,
        revoke: vi.fn(async () => ({ revoked: true }) as unknown),
      },
      modelConfig: {
        listPresets: vi.fn(async () => ({ status: "ok", presets: [] }) as unknown),
        listAvailable: vi.fn(async () => ({ status: "ok", models: [] }) as unknown),
        createPreset: vi.fn(async () => ({ status: "ok" }) as unknown),
        updatePreset: vi.fn(async () => ({ status: "ok" }) as unknown),
        deletePreset: vi.fn(async () => ({ status: "ok" }) as unknown),
        listAssignments: vi.fn(
          async () =>
            ({
              status: "ok",
              assignments: createAssignmentsForAllProfiles(createModelPreset()),
            }) as unknown,
        ),
        updateAssignments: vi.fn(async () => ({ status: "ok", assignments: [] }) as unknown),
      },
    },
  } as unknown as OperatorCore;

  return { core, routingConfigUpdate, secretsRotate, policyCreateOverride };
}
export function expectAuthorizedJsonRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  expected: { url: string; method?: string; body?: unknown },
): void {
  expect(getRequestUrl(input)).toBe(expected.url);
  expect(init?.method ?? "GET").toBe(expected.method ?? "GET");
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-elevated-token");
  if ("body" in expected) {
    expect(JSON.parse(String(init?.body ?? ""))).toEqual(expected.body);
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}
