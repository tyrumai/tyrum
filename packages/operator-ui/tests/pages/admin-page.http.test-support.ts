import React, { act } from "react";
import { expect, vi } from "vitest";
import { createElevatedModeStore, type OperatorCore } from "../../../operator-core/src/index.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import { cleanupTestRoot, renderIntoDocument, type TestRoot } from "../test-utils.js";

export const TEST_TIMESTAMP = "2026-03-01T00:00:00.000Z";
export const ADMIN_HTTP_EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;

export type ExecutionProfileId = (typeof ADMIN_HTTP_EXECUTION_PROFILE_IDS)[number];

export type ModelPresetFixture = {
  preset_id: string;
  preset_key: string;
  display_name: string;
  provider_key: string;
  model_id: string;
  options: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AvailableModelFixture = {
  provider_key: string;
  provider_name: string;
  model_id: string;
  model_name: string;
  family: string | null;
  reasoning: boolean;
  tool_call: boolean;
  modalities: { output: string[] };
};

export type ModelAssignmentFixture = {
  execution_profile_id: string;
  preset_key: string;
  preset_display_name: string;
  provider_key: string;
  model_id: string;
};

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
        getBundle: vi.fn(async () => ({ status: "ok" }) as unknown),
        listOverrides: vi.fn(async () => ({ status: "ok", overrides: [] }) as unknown),
        createOverride: policyCreateOverride,
        revokeOverride: vi.fn(async () => ({ status: "ok" }) as unknown),
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

export function createModelPreset(overrides: Partial<ModelPresetFixture> = {}): ModelPresetFixture {
  return {
    preset_id: "00000000-0000-4000-8000-000000000001",
    preset_key: "preset-default",
    display_name: "Default",
    provider_key: "openai",
    model_id: "gpt-4.1",
    options: {},
    created_at: TEST_TIMESTAMP,
    updated_at: TEST_TIMESTAMP,
    ...overrides,
  };
}

export function createAvailableModel(
  overrides: Partial<AvailableModelFixture> = {},
): AvailableModelFixture {
  return {
    provider_key: "openai",
    provider_name: "OpenAI",
    model_id: "gpt-4.1",
    model_name: "GPT-4.1",
    family: null,
    reasoning: true,
    tool_call: true,
    modalities: { output: ["text"] },
    ...overrides,
  };
}

export function createModelAssignment(
  executionProfileId: ExecutionProfileId,
  preset: Pick<ModelPresetFixture, "preset_key" | "display_name" | "provider_key" | "model_id">,
): ModelAssignmentFixture {
  return {
    execution_profile_id: executionProfileId,
    preset_key: preset.preset_key,
    preset_display_name: preset.display_name,
    provider_key: preset.provider_key,
    model_id: preset.model_id,
  };
}

export function createAssignmentsForAllProfiles(
  preset: Pick<ModelPresetFixture, "preset_key" | "display_name" | "provider_key" | "model_id">,
): ModelAssignmentFixture[] {
  return ADMIN_HTTP_EXECUTION_PROFILE_IDS.map((executionProfileId) =>
    createModelAssignment(executionProfileId, preset),
  );
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

export function stubModelsFetch(input: ModelsFetchStubInput): ReturnType<typeof vi.fn> {
  let deleteAttempt = 0;
  const fetchMock = vi.fn(async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const url = getRequestUrl(requestInput);
    const method = init?.method ?? "GET";
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-elevated-token");

    if (method === "GET" && url === "http://example.test/config/models/presets") {
      return jsonResponse({ status: "ok", presets: resolveValue(input.presets) });
    }
    if (method === "GET" && url === "http://example.test/config/models/presets/available") {
      return jsonResponse({ status: "ok", models: resolveValue(input.models) });
    }
    if (method === "GET" && url === "http://example.test/config/models/assignments") {
      return jsonResponse({ status: "ok", assignments: resolveValue(input.assignments) });
    }
    if (
      method === "POST" &&
      url === "http://example.test/config/models/presets" &&
      input.createPreset
    ) {
      expect(JSON.parse(String(init?.body ?? ""))).toEqual(input.createPreset.expectedBody);
      input.createPreset.afterCreate?.();
      return jsonResponse({ status: "ok", preset: input.createPreset.responsePreset }, 201);
    }
    if (
      method === "PATCH" &&
      url === `http://example.test/config/models/presets/${input.updatePreset?.presetKey}` &&
      input.updatePreset
    ) {
      expect(JSON.parse(String(init?.body ?? ""))).toEqual(input.updatePreset.expectedBody);
      input.updatePreset.afterUpdate?.();
      return jsonResponse(
        { status: "ok", preset: resolveValue(input.updatePreset.responsePreset) },
        200,
      );
    }
    if (
      method === "PUT" &&
      url === "http://example.test/config/models/assignments" &&
      input.updateAssignments
    ) {
      expect(JSON.parse(String(init?.body ?? ""))).toEqual(input.updateAssignments.expectedBody);
      input.updateAssignments.afterUpdate?.();
      return jsonResponse(
        { status: "ok", assignments: resolveValue(input.updateAssignments.responseAssignments) },
        200,
      );
    }
    if (
      method === "DELETE" &&
      url === `http://example.test/config/models/presets/${input.deletePreset?.presetKey}` &&
      input.deletePreset
    ) {
      deleteAttempt += 1;
      return input.deletePreset.handle(JSON.parse(String(init?.body ?? "")), deleteAttempt);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
