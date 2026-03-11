// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setNativeValue } from "../test-utils.js";
import {
  cleanupPanel,
  click,
  clickAndFlush,
  createAdminHttpProvidersTestCore,
  createPreset,
  createProviderAccount,
  createProviderGroup,
  getButton,
  getByTestId,
  getLabeledInput,
  getLabeledSelect,
  getToggleButton,
  openAddAccountDialog,
  openEditAccountDialog,
  renderAdminHttpProvidersPanel,
  setSelectValue,
  setSelectValueWithoutAct,
} from "./admin-http-providers.test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AdminHttpProvidersPanel", () => {
  it("updates the default display name when the selected provider changes", async () => {
    const { core } = createAdminHttpProvidersTestCore();
    const panel = await openAddAccountDialog(core);

    const providerSelect = getLabeledSelect(panel.dialog, "Provider");
    const displayNameInput = getLabeledInput(panel.dialog, "Display name");

    expect(displayNameInput.value).toBe("OpenAI");
    setSelectValue(providerSelect, "anthropic");
    expect(displayNameInput.value).toBe("Anthropic");

    cleanupPanel(panel);
  });

  it("preserves a custom display name when the selected provider changes", async () => {
    const { core } = createAdminHttpProvidersTestCore();
    const panel = await openAddAccountDialog(core);

    const providerSelect = getLabeledSelect(panel.dialog, "Provider");
    const displayNameInput = getLabeledInput(panel.dialog, "Display name");

    act(() => {
      setNativeValue(displayNameInput, "Team account");
    });
    setSelectValue(providerSelect, "anthropic");

    expect(displayNameInput.value).toBe("Team account");
    cleanupPanel(panel);
  });

  it("keeps the auto-filled display name aligned during rapid provider changes", async () => {
    const { core } = createAdminHttpProvidersTestCore();
    const panel = await openAddAccountDialog(core);

    const providerSelect = getLabeledSelect(panel.dialog, "Provider");
    const displayNameInput = getLabeledInput(panel.dialog, "Display name");

    expect(displayNameInput.value).toBe("OpenAI");
    act(() => {
      setSelectValueWithoutAct(providerSelect, "anthropic");
      setSelectValueWithoutAct(providerSelect, "openai");
    });

    expect(providerSelect.value).toBe("openai");
    expect(displayNameInput.value).toBe("OpenAI");
    cleanupPanel(panel);
  });

  it("creates provider accounts from the add dialog", async () => {
    const account = createProviderAccount("openai", {
      account_id: "00000000-0000-4000-8000-000000000101",
      display_name: "Primary OpenAI",
      config: {
        base_url: "https://proxy.example.test/v1",
        use_responses_api: true,
      },
    });
    const { core, setProviders } = createAdminHttpProvidersTestCore();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
      expect(url).toBe("http://example.test/config/providers/accounts");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-elevated-token");
      expect(JSON.parse(String(init?.body ?? ""))).toEqual({
        provider_key: "openai",
        method_key: "api_key",
        display_name: "Primary OpenAI",
        config: {
          base_url: "https://proxy.example.test/v1",
          use_responses_api: true,
        },
        secrets: { api_key: "sk-openai" },
      });

      setProviders([createProviderGroup("openai", { accounts: [account] })]);
      return new Response(JSON.stringify({ status: "ok", account }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const panel = await openAddAccountDialog(core);

    expect(panel.container.textContent).toContain("Some providers are not configurable yet");

    const displayNameInput = getLabeledInput(panel.dialog, "Display name");
    const baseUrlInput = getLabeledInput(panel.dialog, "Base URL");
    const apiKeyInput = getLabeledInput(panel.dialog, "API key");
    const configToggle = getToggleButton(panel.dialog, "Use Responses API");

    act(() => {
      setNativeValue(displayNameInput, "Primary OpenAI");
      setNativeValue(baseUrlInput, "https://proxy.example.test/v1");
      setNativeValue(apiKeyInput, "sk-openai");
      configToggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "providers-save"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(panel.container.textContent).toContain("Primary OpenAI");
    expect(panel.container.textContent).toContain("Provider documentation");

    cleanupPanel(panel);
  });

  it("edits, disables, and removes provider accounts", async () => {
    const initialAccount = createProviderAccount("openai", {
      display_name: "Primary OpenAI",
      config: {
        base_url: "https://proxy.example.test/v1",
        use_responses_api: false,
      },
    });
    const { core, setProviders } = createAdminHttpProvidersTestCore({
      providers: [createProviderGroup("openai", { accounts: [initialAccount] })],
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
          setProviders([createProviderGroup("openai", { accounts: [updatedAccount] })]);
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
        const updatedAccount = createProviderAccount("openai", {
          display_name: "Renamed OpenAI",
          config: {
            base_url: "https://new.example.test/v1",
            use_responses_api: true,
          },
        });
        setProviders([createProviderGroup("openai", { accounts: [updatedAccount] })]);
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

    const panel = await openEditAccountDialog(core);

    const providerSelect = getLabeledSelect(panel.dialog, "Provider");
    const methodSelect = getLabeledSelect(panel.dialog, "Authentication method");
    const displayNameInput = getLabeledInput(panel.dialog, "Display name");
    const baseUrlInput = getLabeledInput(panel.dialog, "Base URL");
    const apiKeyInput = getLabeledInput(panel.dialog, "API key");
    const configToggle = getToggleButton(panel.dialog, "Use Responses API");

    expect(providerSelect.disabled).toBe(true);
    expect(methodSelect.disabled).toBe(true);
    expect(displayNameInput.value).toBe("Primary OpenAI");
    expect(baseUrlInput.value).toBe("https://proxy.example.test/v1");
    expect(apiKeyInput.value).toBe("");
    expect(panel.dialog.textContent).toContain("Leave blank to keep the current value.");

    act(() => {
      setNativeValue(displayNameInput, "Renamed OpenAI");
      setNativeValue(baseUrlInput, "https://new.example.test/v1");
      configToggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "providers-save"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(panel.container.textContent).toContain("Renamed OpenAI");

    await clickAndFlush(getButton(panel.container, "Disable"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(panel.container.textContent).toContain("disabled");

    const removeAccountButton =
      Array.from(panel.container.querySelectorAll<HTMLButtonElement>("button")).findLast(
        (button) => button.textContent?.trim() === "Remove",
      ) ?? null;

    expect(removeAccountButton).not.toBeNull();
    click(removeAccountButton);
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(panel.container.textContent).toContain("No providers configured");

    cleanupPanel(panel);
  });

  it("requires replacement presets when provider removal conflicts with assignments", async () => {
    const { core, setProviders, setPresets } = createAdminHttpProvidersTestCore({
      providers: [
        createProviderGroup("openai", {
          accounts: [
            createProviderAccount("openai", {
              account_id: "00000000-0000-4000-8000-000000000121",
              display_name: "Primary OpenAI",
            }),
          ],
        }),
      ],
      presets: [createPreset("openai"), createPreset("anthropic")],
    });

    let deleteAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
      expect(url).toBe("http://example.test/config/providers/openai");
      expect(init?.method).toBe("DELETE");
      deleteAttempts += 1;

      if (deleteAttempts === 1) {
        expect(init?.body).toBeUndefined();
        setPresets([createPreset("openai"), createPreset("anthropic")]);
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

    const panel = await renderAdminHttpProvidersPanel(core);

    click(getButton(panel.container, "Remove provider"));
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "Select replacement presets or None before removing this provider.",
    );

    setSelectValue(
      getLabeledSelect(
        getByTestId<HTMLElement>(document.body, "confirm-danger-dialog"),
        "Interaction replacement",
      ),
      "anthropic-default",
    );
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(panel.container.textContent).toContain("No providers configured");

    cleanupPanel(panel);
  });

  it("accepts the visible None replacement after a provider removal conflict", async () => {
    const { core, setProviders, setPresets } = createAdminHttpProvidersTestCore({
      providers: [
        createProviderGroup("openai", {
          accounts: [
            createProviderAccount("openai", {
              account_id: "00000000-0000-4000-8000-000000000122",
              display_name: "Primary OpenAI",
            }),
          ],
        }),
      ],
      presets: [createPreset("openai"), createPreset("anthropic")],
    });

    let deleteAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
      expect(url).toBe("http://example.test/config/providers/openai");
      expect(init?.method).toBe("DELETE");
      deleteAttempts += 1;

      if (deleteAttempts === 1) {
        expect(init?.body).toBeUndefined();
        setPresets([createPreset("openai"), createPreset("anthropic")]);
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
        replacement_assignments: { interaction: null },
      });
      setProviders([]);
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const panel = await renderAdminHttpProvidersPanel(core);

    click(getButton(panel.container, "Remove provider"));
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "Select replacement presets or None before removing this provider.",
    );

    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(panel.container.textContent).toContain("No providers configured");

    cleanupPanel(panel);
  });
});
