// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setNativeValue } from "../test-utils.js";
import {
  ADMIN_HTTP_EXECUTION_PROFILE_IDS,
  setModelConfigResponses,
} from "./admin-page.http.models.shared.js";
import {
  setupAssignmentsUpdateScenario,
  setupCreatePresetScenario,
  setupDeletePresetScenario,
  setupRefreshPresetScenario,
  setupUpdatePresetScenario,
} from "./admin-page.http.models.test-support.js";
import {
  cleanupAdminHttpPage,
  click,
  clickAndFlush,
  createAdminHttpTestCore,
  expectPresent,
  flush,
  getButton,
  getByTestId,
  openModelsTab,
  renderAdminHttpConfigurePage,
  setSelectValue,
  switchHttpTab,
} from "./admin-page.http.test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP) models", () => {
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

    expect(page.container.textContent).toContain("No models configured");
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

  it("requires replacements before deleting a preset and handles assignment conflicts", async () => {
    const { core } = createAdminHttpTestCore();
    const { fetchMock } = setupDeletePresetScenario(core);

    const page = renderAdminHttpConfigurePage(core);
    await openModelsTab(page.container);

    click(getButton(page.container, "Remove"));

    const confirmDialog = getByTestId<HTMLElement>(document.body, "confirm-danger-dialog");
    const confirmButton = getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm");

    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(confirmButton);

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(document.body.textContent).toContain(
      "Select a replacement preset for every required execution profile.",
    );

    setSelectValue(
      expectPresent(confirmDialog.querySelector<HTMLSelectElement>("select")),
      "preset-review",
    );
    await clickAndFlush(confirmButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(
      "Select replacement presets before removing this model.",
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
});
