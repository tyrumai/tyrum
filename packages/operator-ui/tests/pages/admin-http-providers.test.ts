// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createElevatedModeStore, type OperatorCore } from "../../../operator-core/src/index.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { AdminHttpProvidersPanel } from "../../src/components/pages/admin-http-providers.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setSelectValue(select: HTMLSelectElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set as
      | ((this: HTMLSelectElement, value: string) => void)
      | undefined;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function findLabeledInput(root: ParentNode, labelPrefix: string): HTMLInputElement | null {
  const label = Array.from(root.querySelectorAll<HTMLLabelElement>("label")).find((candidate) =>
    candidate.textContent?.trim().startsWith(labelPrefix),
  );
  const id = label?.htmlFor;
  return id ? root.querySelector<HTMLInputElement>(`input[id="${id}"]`) : null;
}

function findLabeledSelect(root: ParentNode, labelPrefix: string): HTMLSelectElement | null {
  const label = Array.from(root.querySelectorAll<HTMLLabelElement>("label")).find((candidate) =>
    candidate.textContent?.trim().startsWith(labelPrefix),
  );
  const id = label?.htmlFor;
  return id ? root.querySelector<HTMLSelectElement>(`select[id="${id}"]`) : null;
}

function findButton(root: ParentNode, text: string): HTMLButtonElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === text,
    ) ?? null
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function createTestCore(input?: {
  providers?: Array<Record<string, unknown>>;
  presets?: Array<Record<string, unknown>>;
}) {
  const elevatedModeStore = createElevatedModeStore({
    tickIntervalMs: 0,
    now: () => Date.parse("2026-03-01T00:00:00.000Z"),
  });
  elevatedModeStore.enter({
    elevatedToken: "test-elevated-token",
    expiresAt: "2026-03-01T00:10:00.000Z",
  });

  const registry = [
    {
      provider_key: "openai",
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
    {
      provider_key: "anthropic",
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
    {
      provider_key: "unsupported",
      name: "Unsupported",
      doc: null,
      supported: false,
      methods: [],
    },
  ];

  let providers = input?.providers ?? [];
  let presets = input?.presets ?? [];

  const core = {
    httpBaseUrl: "http://example.test",
    elevatedModeStore,
    http: {
      providerConfig: {
        listRegistry: vi.fn(async () => ({ status: "ok", providers: registry }) as unknown),
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

describe("AdminHttpProvidersPanel", () => {
  it("creates provider accounts from the add dialog", async () => {
    const { core, setProviders } = createTestCore();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
      expect(url).toBe("http://example.test/config/providers/accounts");
      expect(init?.method).toBe("POST");

      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-elevated-token");

      const account = {
        account_id: "00000000-0000-4000-8000-000000000101",
        account_key: "openai-primary",
        provider_key: "openai",
        display_name: "Primary OpenAI",
        method_key: "api_key",
        type: "api_key",
        status: "active",
        config: {
          base_url: "https://proxy.example.test/v1",
          use_responses_api: true,
        },
        configured_secret_keys: ["api_key"],
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
      };
      const bodyRaw = String(init?.body ?? "");
      expect(JSON.parse(bodyRaw)).toEqual({
        provider_key: "openai",
        method_key: "api_key",
        display_name: "Primary OpenAI",
        config: {
          base_url: "https://proxy.example.test/v1",
          use_responses_api: true,
        },
        secrets: {
          api_key: "sk-openai",
        },
      });

      setProviders([
        {
          provider_key: "openai",
          name: "OpenAI",
          doc: "https://platform.openai.com/docs",
          supported: true,
          accounts: [account],
        },
      ]);

      return new Response(JSON.stringify({ status: "ok", account }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(AdminHttpProvidersPanel, { core }),
      ),
    );

    await flush();

    expect(container.textContent).toContain("Some providers are not configurable yet");

    const addButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='providers-add-open']",
    );
    expect(addButton).not.toBeNull();
    act(() => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector<HTMLElement>(
      "[data-testid='providers-account-dialog']",
    );
    expect(dialog).not.toBeNull();

    const displayNameInput = findLabeledInput(dialog!, "Display name");
    const baseUrlInput = findLabeledInput(dialog!, "Base URL");
    const apiKeyInput = findLabeledInput(dialog!, "API key");
    const configToggleLabel = Array.from(
      dialog?.querySelectorAll<HTMLLabelElement>("label") ?? [],
    ).find((label) => label.textContent?.includes("Use Responses API"));
    const configToggle = configToggleLabel?.querySelector<HTMLElement>("button");

    expect(displayNameInput).not.toBeNull();
    expect(baseUrlInput).not.toBeNull();
    expect(apiKeyInput).not.toBeNull();
    expect(configToggle).not.toBeNull();

    act(() => {
      setNativeValue(displayNameInput!, "Primary OpenAI");
      setNativeValue(baseUrlInput!, "https://proxy.example.test/v1");
      setNativeValue(apiKeyInput!, "sk-openai");
      configToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const saveButton = document.body.querySelector<HTMLButtonElement>(
      "[data-testid='providers-save']",
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Primary OpenAI");
    expect(container.textContent).toContain("Provider documentation");

    cleanupTestRoot({ container, root });
  });

  it("edits, disables, and removes provider accounts", async () => {
    const initialAccount = {
      account_id: "00000000-0000-4000-8000-000000000111",
      account_key: "openai-primary",
      provider_key: "openai",
      display_name: "Primary OpenAI",
      method_key: "api_key",
      type: "api_key",
      status: "active",
      config: {
        base_url: "https://proxy.example.test/v1",
        use_responses_api: false,
      },
      configured_secret_keys: ["api_key"],
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    };
    const { core, setProviders } = createTestCore({
      providers: [
        {
          provider_key: "openai",
          name: "OpenAI",
          doc: "https://platform.openai.com/docs",
          supported: true,
          accounts: [initialAccount],
        },
      ],
    });

    let accountStatus: "active" | "disabled" = "active";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";

      if (url.endsWith("/config/providers/accounts/openai-primary") && init?.method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? ""));
        if ("status" in body) {
          accountStatus = body.status;
          const updatedAccount = {
            ...initialAccount,
            display_name: "Renamed OpenAI",
            status: accountStatus,
          };
          setProviders([
            {
              provider_key: "openai",
              name: "OpenAI",
              doc: "https://platform.openai.com/docs",
              supported: true,
              accounts: [updatedAccount],
            },
          ]);
          return new Response(JSON.stringify({ status: "ok", account: updatedAccount }), {
            status: 200,
          });
        }

        expect(body).toEqual({
          display_name: "Renamed OpenAI",
          config: {
            base_url: "https://new.example.test/v1",
            use_responses_api: true,
          },
          secrets: {},
        });
        const updatedAccount = {
          ...initialAccount,
          display_name: "Renamed OpenAI",
          config: {
            base_url: "https://new.example.test/v1",
            use_responses_api: true,
          },
        };
        setProviders([
          {
            provider_key: "openai",
            name: "OpenAI",
            doc: "https://platform.openai.com/docs",
            supported: true,
            accounts: [updatedAccount],
          },
        ]);
        return new Response(JSON.stringify({ status: "ok", account: updatedAccount }), {
          status: 200,
        });
      }

      expect(url).toBe("http://example.test/config/providers/accounts/openai-primary");
      expect(init?.method).toBe("DELETE");
      setProviders([]);
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(AdminHttpProvidersPanel, { core }),
      ),
    );

    await flush();

    const editButton = findButton(container, "Edit");
    expect(editButton).not.toBeNull();
    act(() => {
      editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector<HTMLElement>(
      "[data-testid='providers-account-dialog']",
    );
    expect(dialog).not.toBeNull();

    const providerSelect = findLabeledSelect(dialog!, "Provider");
    const methodSelect = findLabeledSelect(dialog!, "Authentication method");
    const displayNameInput = findLabeledInput(dialog!, "Display name");
    const baseUrlInput = findLabeledInput(dialog!, "Base URL");
    const apiKeyInput = findLabeledInput(dialog!, "API key");
    const configToggleLabel = Array.from(
      dialog?.querySelectorAll<HTMLLabelElement>("label") ?? [],
    ).find((label) => label.textContent?.includes("Use Responses API"));
    const configToggle = configToggleLabel?.querySelector<HTMLElement>("button");

    expect(providerSelect?.disabled).toBe(true);
    expect(methodSelect?.disabled).toBe(true);
    expect(displayNameInput?.value).toBe("Primary OpenAI");
    expect(baseUrlInput?.value).toBe("https://proxy.example.test/v1");
    expect(apiKeyInput?.value).toBe("");
    expect(dialog?.textContent).toContain("Leave blank to keep the current value.");

    act(() => {
      setNativeValue(displayNameInput!, "Renamed OpenAI");
      setNativeValue(baseUrlInput!, "https://new.example.test/v1");
      configToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const saveButton = document.body.querySelector<HTMLButtonElement>(
      "[data-testid='providers-save']",
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Renamed OpenAI");

    const disableButton = findButton(container, "Disable");
    expect(disableButton).not.toBeNull();

    await act(async () => {
      disableButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("disabled");

    const removeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((button) => button.textContent?.trim() === "Remove");
    const removeAccountButton = removeButtons.at(-1) ?? null;
    expect(removeAccountButton).not.toBeNull();
    act(() => {
      removeAccountButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmCheckbox = document.body.querySelector<HTMLElement>(
      "[data-testid='confirm-danger-checkbox']",
    );
    const confirmButton = document.body.querySelector<HTMLButtonElement>(
      "[data-testid='confirm-danger-confirm']",
    );
    expect(confirmCheckbox).not.toBeNull();
    expect(confirmButton).not.toBeNull();

    act(() => {
      confirmCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("No providers configured");

    cleanupTestRoot({ container, root });
  });

  it("requires replacement presets when provider removal conflicts with assignments", async () => {
    const providerGroup = {
      provider_key: "openai",
      name: "OpenAI",
      doc: "https://platform.openai.com/docs",
      supported: true,
      accounts: [
        {
          account_id: "00000000-0000-4000-8000-000000000121",
          account_key: "openai-primary",
          provider_key: "openai",
          display_name: "Primary OpenAI",
          method_key: "api_key",
          type: "api_key",
          status: "active",
          config: {},
          configured_secret_keys: ["api_key"],
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
      ],
    };
    const { core, setProviders, setPresets } = createTestCore({
      providers: [providerGroup],
      presets: [
        {
          preset_id: "00000000-0000-4000-8000-000000000131",
          preset_key: "openai-default",
          display_name: "OpenAI Default",
          provider_key: "openai",
          model_id: "gpt-4.1",
          options: {},
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
        {
          preset_id: "00000000-0000-4000-8000-000000000132",
          preset_key: "anthropic-default",
          display_name: "Anthropic Default",
          provider_key: "anthropic",
          model_id: "claude-3.7-sonnet",
          options: {},
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
      ],
    });

    let deleteAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
      expect(url).toBe("http://example.test/config/providers/openai");
      expect(init?.method).toBe("DELETE");
      deleteAttempts += 1;

      if (deleteAttempts === 1) {
        expect(init?.body).toBeUndefined();
        setPresets([
          {
            preset_id: "00000000-0000-4000-8000-000000000131",
            preset_key: "openai-default",
            display_name: "OpenAI Default",
            provider_key: "openai",
            model_id: "gpt-4.1",
            options: {},
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
          },
          {
            preset_id: "00000000-0000-4000-8000-000000000132",
            preset_key: "anthropic-default",
            display_name: "Anthropic Default",
            provider_key: "anthropic",
            model_id: "claude-3.7-sonnet",
            options: {},
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
          },
        ]);
        return new Response(
          JSON.stringify({
            error: "assignment_required",
            message: "Execution profiles still reference this provider.",
            required_execution_profile_ids: ["interaction"],
          }),
          { status: 409 },
        );
      }

      expect(JSON.parse(String(init?.body ?? ""))).toEqual({
        replacement_assignments: { interaction: "anthropic-default" },
      });
      setProviders([]);
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = renderIntoDocument(
      React.createElement(
        ElevatedModeProvider,
        { core, mode: "web" },
        React.createElement(AdminHttpProvidersPanel, { core }),
      ),
    );

    await flush();

    const removeProviderButton = findButton(container, "Remove provider");
    expect(removeProviderButton).not.toBeNull();
    act(() => {
      removeProviderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmDialog = document.body.querySelector<HTMLElement>(
      "[data-testid='confirm-danger-dialog']",
    );
    const confirmCheckbox = document.body.querySelector<HTMLElement>(
      "[data-testid='confirm-danger-checkbox']",
    );
    const confirmButton = document.body.querySelector<HTMLButtonElement>(
      "[data-testid='confirm-danger-confirm']",
    );
    expect(confirmDialog).not.toBeNull();
    expect(confirmCheckbox).not.toBeNull();
    expect(confirmButton).not.toBeNull();

    act(() => {
      confirmCheckbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "Select replacement presets before removing this provider.",
    );

    const replacementSelect = findLabeledSelect(confirmDialog!, "Interaction replacement");
    expect(replacementSelect).not.toBeNull();
    setSelectValue(replacementSelect!, "anthropic-default");

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("No providers configured");

    cleanupTestRoot({ container, root });
  });
});
