import React, { act } from "react";
import { expect, vi } from "vitest";
import { createElevatedModeStore, type OperatorCore } from "../../../operator-core/src/index.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { AdminHttpProvidersPanel } from "../../src/components/pages/admin-http-providers.js";
import { cleanupTestRoot, renderIntoDocument, type TestRoot } from "../test-utils.js";

let adminHttpClient: OperatorCore["http"] | null = null;

vi.mock("../../src/components/pages/admin-http-shared.js", async () => {
  const actual = await import("../../src/components/pages/admin-http-shared.js");
  return {
    ...actual,
    useAdminHttpClient: () => adminHttpClient,
  };
});

const TEST_TIMESTAMP = "2026-03-01T00:00:00.000Z";

const PROVIDER_DETAILS = {
  openai: {
    name: "OpenAI",
    doc: "https://platform.openai.com/docs",
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
          {
            key: "base_url",
            label: "Base URL",
            description: "Optional API endpoint override",
            kind: "config",
            input: "text",
            required: false,
          },
          {
            key: "use_responses_api",
            label: "Use Responses API",
            description: "Enable the Responses API transport.",
            kind: "config",
            input: "boolean",
            required: false,
          },
        ],
      },
    ],
  },
  anthropic: {
    name: "Anthropic",
    doc: "https://docs.anthropic.com",
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
  unsupported: {
    name: "Unsupported",
    doc: null,
    supported: false,
    methods: [],
  },
} as const;

const PRESET_DEFAULTS = {
  openai: {
    preset_id: "00000000-0000-4000-8000-000000000131",
    preset_key: "openai-default",
    display_name: "OpenAI Default",
    provider_key: "openai",
    model_id: "gpt-4.1",
  },
  anthropic: {
    preset_id: "00000000-0000-4000-8000-000000000132",
    preset_key: "anthropic-default",
    display_name: "Anthropic Default",
    provider_key: "anthropic",
    model_id: "claude-3.7-sonnet",
  },
} as const;

type ProviderKey = keyof typeof PROVIDER_DETAILS;
type PresetProviderKey = keyof typeof PRESET_DEFAULTS;
const PROVIDER_KEYS = Object.keys(PROVIDER_DETAILS) as ProviderKey[];

function getJsonHeaders(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${String(response.status)}`);
  }
  return (await response.json()) as unknown;
}

function createFetchBackedAdminHttp(core: OperatorCore): OperatorCore["http"] {
  const token = core.elevatedModeStore.getSnapshot().elevatedToken ?? "";
  const providerConfig = core.http.providerConfig;

  return {
    ...core.http,
    providerConfig: {
      ...providerConfig,
      async createAccount(body) {
        const response = await fetch(`${core.httpBaseUrl}/config/providers/accounts`, {
          method: "POST",
          headers: getJsonHeaders(token),
          body: JSON.stringify(body),
        });
        return (await readJsonResponse(response)) as Awaited<
          ReturnType<typeof providerConfig.createAccount>
        >;
      },
      async updateAccount(accountKey, body) {
        const response = await fetch(
          `${core.httpBaseUrl}/config/providers/accounts/${accountKey}`,
          {
            method: "PATCH",
            headers: getJsonHeaders(token),
            body: JSON.stringify(body),
          },
        );
        return (await readJsonResponse(response)) as Awaited<
          ReturnType<typeof providerConfig.updateAccount>
        >;
      },
      async deleteAccount(accountKey) {
        const response = await fetch(
          `${core.httpBaseUrl}/config/providers/accounts/${accountKey}`,
          {
            method: "DELETE",
            headers: { authorization: `Bearer ${token}` },
          },
        );
        return (await readJsonResponse(response)) as Awaited<
          ReturnType<typeof providerConfig.deleteAccount>
        >;
      },
      async deleteProvider(providerKey, body) {
        const response = await fetch(`${core.httpBaseUrl}/config/providers/${providerKey}`, {
          method: "DELETE",
          headers: body ? getJsonHeaders(token) : { authorization: `Bearer ${token}` },
          body: body ? JSON.stringify(body) : undefined,
        });
        return (await response.json()) as Awaited<ReturnType<typeof providerConfig.deleteProvider>>;
      },
    },
  } as OperatorCore["http"];
}

function expectPresent<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  return value as T;
}

function findLabeledElement<T extends Element>(
  root: ParentNode,
  selector: "input" | "select",
  labelPrefix: string,
): T | null {
  const label = Array.from(root.querySelectorAll<HTMLLabelElement>("label")).find((candidate) =>
    candidate.textContent?.trim().startsWith(labelPrefix),
  );
  const id = label?.htmlFor;
  return id ? root.querySelector<T>(`${selector}[id="${id}"]`) : null;
}

export function setSelectValue(select: HTMLSelectElement, value: string): void {
  act(() => {
    setSelectValueWithoutAct(select, value);
  });
}

export function setSelectValueWithoutAct(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set as
    | ((this: HTMLSelectElement, value: string) => void)
    | undefined;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

export function getLabeledInput(root: ParentNode, labelPrefix: string): HTMLInputElement {
  return expectPresent(findLabeledElement<HTMLInputElement>(root, "input", labelPrefix));
}

export function getLabeledSelect(root: ParentNode, labelPrefix: string): HTMLSelectElement {
  return expectPresent(findLabeledElement<HTMLSelectElement>(root, "select", labelPrefix));
}

export function getProviderOption(root: ParentNode, providerKey: string): HTMLButtonElement {
  return getByTestId<HTMLButtonElement>(root, `providers-provider-option-${providerKey}`);
}

export function getButton(root: ParentNode, text: string): HTMLButtonElement {
  return expectPresent(
    Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === text,
    ),
  );
}

export function getToggleButton(root: ParentNode, labelText: string): HTMLElement {
  return expectPresent(
    Array.from(root.querySelectorAll<HTMLLabelElement>("label"))
      .find((label) => label.textContent?.includes(labelText))
      ?.querySelector<HTMLElement>("button"),
  );
}

export function getByTestId<T extends Element>(root: ParentNode, testId: string): T {
  return expectPresent(root.querySelector<T>(`[data-testid='${testId}']`));
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
  await flush();
}

export function createProviderAccount(
  providerKey: Exclude<ProviderKey, "unsupported">,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    account_id:
      providerKey === "openai"
        ? "00000000-0000-4000-8000-000000000111"
        : "00000000-0000-4000-8000-000000000211",
    account_key: `${providerKey}-primary`,
    provider_key: providerKey,
    display_name: PROVIDER_DETAILS[providerKey].name,
    method_key: "api_key",
    type: "api_key",
    status: "active",
    config: {},
    configured_secret_keys: ["api_key"],
    created_at: TEST_TIMESTAMP,
    updated_at: TEST_TIMESTAMP,
    ...overrides,
  };
}

export function createProviderGroup(
  providerKey: ProviderKey,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    provider_key: providerKey,
    ...PROVIDER_DETAILS[providerKey],
    accounts: [],
    ...overrides,
  };
}

function createRegistryProvider(providerKey: ProviderKey): Record<string, unknown> {
  return {
    provider_key: providerKey,
    ...PROVIDER_DETAILS[providerKey],
  };
}

export function createPreset(
  providerKey: PresetProviderKey,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...PRESET_DEFAULTS[providerKey],
    options: {},
    created_at: TEST_TIMESTAMP,
    updated_at: TEST_TIMESTAMP,
    ...overrides,
  };
}

export function createAdminHttpProvidersTestCore(input?: {
  providers?: Array<Record<string, unknown>>;
  presets?: Array<Record<string, unknown>>;
}) {
  const elevatedModeStore = createElevatedModeStore({
    tickIntervalMs: 0,
    now: () => Date.parse(TEST_TIMESTAMP),
  });
  elevatedModeStore.enter({
    elevatedToken: "test-elevated-token",
    expiresAt: "2026-03-01T00:10:00.000Z",
  });

  let providers = input?.providers ?? [];
  let presets = input?.presets ?? [];

  const core = {
    httpBaseUrl: "http://example.test",
    elevatedModeStore,
    http: {
      providerConfig: {
        listRegistry: vi.fn(
          async () =>
            ({
              status: "ok",
              providers: PROVIDER_KEYS.map((providerKey) => createRegistryProvider(providerKey)),
            }) as unknown,
        ),
        listProviders: vi.fn(async () => ({ status: "ok", providers }) as unknown),
        createAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
        updateAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
        deleteAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
        deleteProvider: vi.fn(async () => ({ status: "ok" }) as unknown),
      },
      modelConfig: {
        listPresets: vi.fn(async () => ({ status: "ok", presets }) as unknown),
      },
    },
  } as unknown as OperatorCore;

  return {
    core,
    setProviders(nextProviders: Array<Record<string, unknown>>) {
      providers = nextProviders;
    },
    setPresets(nextPresets: Array<Record<string, unknown>>) {
      presets = nextPresets;
    },
  };
}

export async function renderAdminHttpProvidersPanel(core: OperatorCore): Promise<TestRoot> {
  adminHttpClient = createFetchBackedAdminHttp(core);
  const testRoot = renderIntoDocument(
    React.createElement(
      ElevatedModeProvider,
      { core, mode: "web" },
      React.createElement(AdminHttpProvidersPanel, { core }),
    ),
  );
  await flush();
  return testRoot;
}

export async function openAddAccountDialog(
  core: OperatorCore,
): Promise<TestRoot & { dialog: HTMLElement }> {
  const testRoot = await renderAdminHttpProvidersPanel(core);
  click(getByTestId<HTMLButtonElement>(testRoot.container, "providers-add-open"));
  return {
    ...testRoot,
    dialog: getByTestId<HTMLElement>(document.body, "providers-account-dialog"),
  };
}

export async function openAddExistingProviderAccountDialog(
  core: OperatorCore,
  providerKey: string,
): Promise<TestRoot & { dialog: HTMLElement }> {
  const testRoot = await renderAdminHttpProvidersPanel(core);
  click(
    getByTestId<HTMLButtonElement>(
      testRoot.container,
      `providers-group-add-account-${providerKey}`,
    ),
  );
  return {
    ...testRoot,
    dialog: getByTestId<HTMLElement>(document.body, "providers-account-dialog"),
  };
}

export async function openEditAccountDialog(
  core: OperatorCore,
): Promise<TestRoot & { dialog: HTMLElement }> {
  const testRoot = await renderAdminHttpProvidersPanel(core);
  click(getButton(testRoot.container, "Edit"));
  return {
    ...testRoot,
    dialog: getByTestId<HTMLElement>(document.body, "providers-account-dialog"),
  };
}

export function cleanupPanel(testRoot: TestRoot): void {
  adminHttpClient = null;
  cleanupTestRoot(testRoot);
}
