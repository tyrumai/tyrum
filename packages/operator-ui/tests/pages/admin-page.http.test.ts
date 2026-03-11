// @vitest-environment jsdom

import { act } from "react";
import { createElevatedModeStore, type OperatorCore } from "../../../operator-core/src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setNativeValue } from "../test-utils.js";
import {
  setupAssignmentsUpdateScenario,
  setupCreatePresetScenario,
  setupDeletePresetScenario,
  setupFirstAssignmentSaveScenario,
  setupRefreshPresetScenario,
  setupUpdatePresetScenario,
} from "./admin-page.http.models.test-support.js";
import {
  ADMIN_HTTP_EXECUTION_PROFILE_IDS,
  cleanupAdminHttpPage,
  click,
  clickAndFlush,
  createAdminHttpTestCore,
  expectAuthorizedJsonRequest,
  expectPresent,
  flush,
  getButton,
  getByTestId,
  jsonResponse,
  openModelsTab,
  openPolicyTab,
  renderAdminHttpConfigurePage,
  setModelConfigResponses,
  setSelectValue,
  switchHttpTab,
} from "./admin-page.http.test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP)", () => {
  it("renders Routing config and Secrets panels", async () => {
    const { core } = createAdminHttpTestCore();
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    expect(
      page.container.querySelector("[data-testid='admin-http-routing-config']"),
    ).not.toBeNull();

    await switchHttpTab(page.container, "admin-http-tab-secrets");
    expect(page.container.querySelector("[data-testid='admin-http-secrets']")).not.toBeNull();

    cleanupAdminHttpPage(page);
  });

  it("enables saving the first execution-profile assignment set", async () => {
    const { core } = createAdminHttpTestCore();
    const { presetReview } = setupFirstAssignmentSaveScenario(core);

    const page = renderAdminHttpConfigurePage(core);
    await openModelsTab(page.container);

    const selects = Array.from(page.container.querySelectorAll<HTMLSelectElement>("select"));
    expect(selects).toHaveLength(ADMIN_HTTP_EXECUTION_PROFILE_IDS.length);

    const saveButton = getByTestId<HTMLButtonElement>(page.container, "models-assignments-save");
    expect(saveButton.disabled).toBe(true);

    for (const select of selects) {
      setSelectValue(select, presetReview.preset_key);
    }

    expect(saveButton.disabled).toBe(false);
    cleanupAdminHttpPage(page);
  });
});

describe("ConfigurePage (HTTP) routing config", () => {
  it("saves telegram connection settings through a confirmed mutation", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/routing/channels/telegram/config",
        method: "PUT",
        body: {
          bot_token: "new-bot-token",
          allowed_user_ids: ["123", "456"],
          pipeline_enabled: true,
        },
      });
      return jsonResponse({
        revision: 4,
        config: {
          bot_token_configured: true,
          webhook_secret_configured: true,
          allowed_user_ids: ["123", "456"],
          pipeline_enabled: true,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "channels-telegram-bot-token"),
        "new-bot-token",
      );
      setNativeValue(
        getByTestId<HTMLTextAreaElement>(page.container, "channels-telegram-allowed-user-ids"),
        "123\n456",
      );
    });
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "channels-telegram-save-open"));
    await flush();

    expect(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm").disabled).toBe(
      true,
    );

    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });

  it("shows telegram connection save failures in the confirmation dialog", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: "upstream_error",
          message: "telegram config save failed",
        },
        500,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "channels-telegram-bot-token"),
        "new-bot-token",
      );
    });
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "channels-telegram-save-open"));
    await flush();
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("telegram config save failed");
    cleanupAdminHttpPage(page);
  });

  it("filters structured routing rules", async () => {
    const { core } = createAdminHttpTestCore();
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    expect(page.container.textContent).toContain("Support room");

    act(() => {
      setNativeValue(getByTestId<HTMLInputElement>(page.container, "channels-filter"), "missing");
    });
    await flush();

    expect(page.container.textContent).toContain("No routing rules match the current filter");
    cleanupAdminHttpPage(page);
  });

  it("adds a thread override from the structured dialog", async () => {
    const { core, routingConfigUpdate } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/routing/config",
        method: "PUT",
        body: {
          config: {
            v: 1,
            telegram: {
              default_agent_key: "default",
              threads: { "tg-123": "agent-b", "tg-456": "default" },
            },
          },
        },
      });
      return jsonResponse({ revision: 2, config: { v: 1 } }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "channels-add-open"));
    await flush();
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "channels-rule-save"));

    expect(routingConfigUpdate).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });

  it("removes a routing rule via the row action", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/routing/config",
        method: "PUT",
        body: {
          config: {
            v: 1,
            telegram: {
              default_agent_key: "default",
            },
          },
        },
      });
      return jsonResponse({ revision: 2, config: { v: 1 } }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    click(
      expectPresent(
        page.container.querySelector<HTMLButtonElement>('[aria-label="Remove Support room"]'),
      ),
    );
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });

  it("reverts from the structured history table", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/routing/config/revert",
        method: "POST",
        body: { revision: 1 },
      });
      return jsonResponse({ revision: 2, config: { v: 1 } }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    click(
      expectPresent(
        page.container.querySelector<HTMLButtonElement>('[aria-label="Revert to revision 1"]'),
      ),
    );
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });
});

describe("ConfigurePage (HTTP) policy + config", () => {
  it("renders Policy, Providers, and Models panels when Elevated Mode is active", async () => {
    const { core } = createAdminHttpTestCore();
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-policy");
    expect(page.container.querySelector("[data-testid='admin-http-policy']")).not.toBeNull();

    await switchHttpTab(page.container, "admin-http-tab-providers");
    expect(page.container.querySelector("[data-testid='admin-http-providers']")).not.toBeNull();

    await switchHttpTab(page.container, "admin-http-tab-models");
    expect(page.container.querySelector("[data-testid='admin-http-models']")).not.toBeNull();

    cleanupAdminHttpPage(page);
  });

  it("disables policy override creation when JSON is invalid", async () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    elevatedModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    const page = renderAdminHttpConfigurePage({
      httpBaseUrl: "http://example.test",
      elevatedModeStore,
    } as unknown as OperatorCore);

    openPolicyTab(page.container);

    await act(async () => {
      setNativeValue(
        getByTestId<HTMLTextAreaElement>(page.container, "admin-policy-override-create-json"),
        "{",
      );
      await Promise.resolve();
    });

    expect(
      getByTestId<HTMLButtonElement>(page.container, "admin-policy-override-create").disabled,
    ).toBe(true);

    cleanupAdminHttpPage(page);
    elevatedModeStore.dispose();
  });

  it("disables model creation when no provider models are available", async () => {
    const { core } = createAdminHttpTestCore();
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-models");

    expect(getByTestId<HTMLButtonElement>(page.container, "models-add-open").disabled).toBe(true);
    cleanupAdminHttpPage(page);
  });

  it("keeps execution profiles in the empty state when provider models fail to load before any preset exists", async () => {
    const { core } = createAdminHttpTestCore();
    setModelConfigResponses(core, {
      presets: [],
      listAvailableError: new Error("Catalog unavailable"),
      listAssignmentsError: new Error("Assignments unavailable"),
    });

    const page = renderAdminHttpConfigurePage(core);
    await openModelsTab(page.container);

    expect(page.container.textContent).toContain("No model presets configured");
    expect(page.container.textContent).toContain("Available model discovery failed");
    expect(page.container.textContent).not.toContain("Model config failed");

    cleanupAdminHttpPage(page);
  });

  it("saves execution-profile assignments from the models tab", async () => {
    const { core } = createAdminHttpTestCore();
    const { fetchMock, presetReview } = setupAssignmentsUpdateScenario(core);

    const page = renderAdminHttpConfigurePage(core);
    await openModelsTab(page.container);

    const selects = Array.from(page.container.querySelectorAll<HTMLSelectElement>("select"));
    expect(selects).toHaveLength(ADMIN_HTTP_EXECUTION_PROFILE_IDS.length);
    setSelectValue(selects[0]!, presetReview.preset_key);

    const saveButton = getByTestId<HTMLButtonElement>(page.container, "models-assignments-save");
    expect(saveButton.disabled).toBe(false);

    await clickAndFlush(saveButton);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(saveButton.disabled).toBe(true);
    cleanupAdminHttpPage(page);
  });

  it("creates a model preset from the models dialog", async () => {
    const { core } = createAdminHttpTestCore();
    const { fetchMock } = setupCreatePresetScenario(core);

    const page = renderAdminHttpConfigurePage(core);
    await openModelsTab(page.container);

    click(getByTestId<HTMLButtonElement>(page.container, "models-add-open"));
    const dialog = getByTestId<HTMLElement>(document.body, "models-preset-dialog");
    expectPresent(
      Array.from(dialog.querySelectorAll<HTMLInputElement>("input")).find(
        (input) => input.type !== "hidden" && !input.readOnly,
      ),
    );

    const dialogSelects = Array.from(dialog.querySelectorAll<HTMLSelectElement>("select"));
    expect(dialogSelects).toHaveLength(2);
    setSelectValue(dialogSelects[0]!, "openai/gpt-4.1-mini");
    expect(
      expectPresent(
        Array.from(dialog.querySelectorAll<HTMLInputElement>("input")).find(
          (input) => input.type !== "hidden" && !input.readOnly,
        ),
      ).value,
    ).toBe("GPT-4.1 Mini");
    setSelectValue(dialogSelects[1]!, "high");

    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "models-save"));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(page.container.textContent).toContain("GPT-4.1 Mini");
    cleanupAdminHttpPage(page);
  });

  it("refreshes configured models with the elevated client after creating a preset", async () => {
    const { core } = createAdminHttpTestCore();
    const { fetchMock, modelConfig } = setupRefreshPresetScenario(core);

    const page = renderAdminHttpConfigurePage(core);
    await openModelsTab(page.container);

    click(getByTestId<HTMLButtonElement>(page.container, "models-add-open"));
    const dialog = getByTestId<HTMLElement>(document.body, "models-preset-dialog");
    const dialogSelects = Array.from(dialog.querySelectorAll<HTMLSelectElement>("select"));
    expect(dialogSelects).toHaveLength(2);
    setSelectValue(dialogSelects[0]!, "openai/gpt-4.1-mini");

    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "models-save"));
    await flush();

    expect(modelConfig.listPresets).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(page.container.textContent).toContain("GPT-4.1 Mini");
    cleanupAdminHttpPage(page);
  });

  it("shows provider warnings and updates an existing preset", async () => {
    const { core } = createAdminHttpTestCore();
    const { fetchMock } = setupUpdatePresetScenario(core);

    const page = renderAdminHttpConfigurePage(core);
    await openModelsTab(page.container);

    expect(page.container.textContent).toContain("Provider unavailable");
    click(getButton(page.container, "Edit"));

    const dialog = getByTestId<HTMLElement>(document.body, "models-preset-dialog");
    const dialogInputs = Array.from(dialog.querySelectorAll<HTMLInputElement>("input")).filter(
      (input) => input.type !== "hidden",
    );
    const displayNameInput = expectPresent(dialogInputs.find((input) => !input.readOnly));
    const modelInput = expectPresent(dialogInputs.find((input) => input.readOnly));

    expect(displayNameInput.value).toBe("Legacy OpenAI");
    expect(modelInput.value).toBe("openai/gpt-4.1");

    act(() => {
      setNativeValue(displayNameInput, "Renamed preset");
    });
    setSelectValue(expectPresent(dialog.querySelector<HTMLSelectElement>("select")), "medium");

    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "models-save"));
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(page.container.textContent).toContain("Renamed preset");
    cleanupAdminHttpPage(page);
  });

  it("treats untouched None as a valid replacement before resolving preset conflicts", async () => {
    const { core } = createAdminHttpTestCore();
    const { fetchMock } = setupDeletePresetScenario(core);

    const page = renderAdminHttpConfigurePage(core);
    await openModelsTab(page.container);

    click(getButton(page.container, "Remove"));

    const confirmDialog = getByTestId<HTMLElement>(document.body, "confirm-danger-dialog");
    const confirmButton = getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm");

    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(confirmButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "Choose replacement presets or None before removing this model.",
    );

    setSelectValue(
      expectPresent(confirmDialog.querySelector<HTMLSelectElement>("select")),
      "preset-review",
    );
    await clickAndFlush(confirmButton);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(page.container.textContent).not.toContain("Default (openai/gpt-4.1)");
    cleanupAdminHttpPage(page);
  });

  it("requires confirmation before creating policy overrides", async () => {
    const { core, policyCreateOverride } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/policy/overrides",
        method: "POST",
        body: {
          agent_id: "00000000-0000-4000-8000-000000000002",
          tool_id: "tool-1",
          pattern: ".*",
        },
      });
      return jsonResponse(
        {
          override: {
            policy_override_id: "00000000-0000-0000-0000-000000000001",
            status: "active",
            created_at: "2026-03-01T00:00:00.000Z",
            agent_id: "00000000-0000-4000-8000-000000000002",
            tool_id: "tool-1",
            pattern: ".*",
          },
        },
        201,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-policy");

    await act(async () => {
      setNativeValue(
        getByTestId<HTMLTextAreaElement>(page.container, "admin-policy-override-create-json"),
        JSON.stringify(
          {
            agent_id: "00000000-0000-4000-8000-000000000002",
            tool_id: "tool-1",
            pattern: ".*",
          },
          null,
          2,
        ),
      );
      await Promise.resolve();
    });

    click(getByTestId<HTMLButtonElement>(page.container, "admin-policy-override-create"));

    expect(policyCreateOverride).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(0);

    const confirmButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[data-testid="confirm-danger-confirm"]'),
    ).at(-1);
    expect(confirmButton).not.toBeUndefined();
    expect(confirmButton?.disabled).toBe(true);

    const confirmCheckbox = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-testid="confirm-danger-checkbox"]'),
    ).at(-1);
    expect(confirmCheckbox).not.toBeUndefined();

    click(confirmCheckbox);
    expect(confirmButton?.disabled).toBe(false);

    await clickAndFlush(confirmButton);

    expect(policyCreateOverride).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });
});
