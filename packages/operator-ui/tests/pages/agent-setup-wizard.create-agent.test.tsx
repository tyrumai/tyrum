// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentSetupWizard } from "../../src/components/pages/agent-setup-wizard.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";
import { setControlledInputValue } from "../operator-ui.test-support.js";
import { getControlByLabel, setSelectValue } from "./agent-setup-wizard.test-support.js";

describe("AgentSetupWizard create-agent steps", () => {
  it("wires preset and agent step actions in create-agent mode", async () => {
    const onApplySelectedPreset = vi.fn();
    const onBackToProvider = vi.fn();
    const onModelFilterChange = vi.fn();
    const onModelSave = vi.fn();
    const modelStates: Array<Record<string, unknown>> = [];
    let modelState = {
      displayName: "Existing preset",
      modelRef: "openrouter:openai/gpt-5.4",
      reasoningEffort: "",
      reasoningVisibility: "",
    };
    const onModelStateChange = vi.fn(
      (updater: (current: typeof modelState) => typeof modelState) => {
        modelState = updater(modelState);
        modelStates.push(modelState);
      },
    );
    const onSelectedPresetKeyChange = vi.fn();
    const onBackToPreset = vi.fn();
    const onCancel = vi.fn();
    const onNameChange = vi.fn();
    const onRandomizeName = vi.fn();
    const onSave = vi.fn();
    const onToneChange = vi.fn();

    const presetRoot = renderIntoDocument(
      <AgentSetupWizard
        busy={false}
        mode="create_agent"
        onCancel={onCancel}
        step="preset"
        provider={{
          canSave: false,
          configuredProviders: [],
          filteredProviders: [],
          onProviderFilterChange: vi.fn(),
          onProviderSave: vi.fn(),
          onProviderSelectionChange: vi.fn(),
          onProviderStateChange: vi.fn(),
          providerFilter: "",
          providerFormError: null,
          providerState: {
            providerKey: "",
            methodKey: "",
            displayName: "",
            configValues: {},
            secretValues: {},
          },
          selectedMethod: undefined,
          selectedProvider: undefined,
        }}
        preset={{
          canApplySelectedPreset: true,
          canReturnToProvider: true,
          canSave: true,
          filteredAvailableModels: [
            {
              provider_key: "openrouter",
              provider_name: "OpenRouter",
              model_id: "openai/gpt-5.4",
              model_name: "GPT-5.4",
              family: "GPT-5",
              reasoning: true,
              tool_call: true,
              modalities: { output: ["text"] },
            },
          ],
          modelFilter: "",
          modelState,
          onApplySelectedPreset,
          onBackToProvider,
          onModelFilterChange,
          onModelSave,
          onModelSelectionChange: vi.fn(),
          onModelStateChange,
          onSelectedPresetKeyChange,
          presets: [
            {
              preset_id: "preset-1",
              preset_key: "gpt-5-4",
              display_name: "GPT-5.4",
              provider_key: "openrouter",
              model_id: "openai/gpt-5.4",
              options: {},
              created_at: "2026-03-08T00:00:00.000Z",
              updated_at: "2026-03-08T00:00:00.000Z",
            },
          ],
          selectedPresetKey: "gpt-5-4",
        }}
        agent={{
          canSave: false,
          name: "",
          onBackToPreset: undefined,
          onNameChange: vi.fn(),
          onSave: vi.fn(),
          onToneChange: vi.fn(),
          selectedPresetLabel: "",
          tone: "direct",
        }}
      />,
    );

    const savedPresetSelect = getControlByLabel<HTMLSelectElement>(
      presetRoot.container,
      "select",
      "Saved preset",
    );
    const displayNameInput = getControlByLabel<HTMLInputElement>(
      presetRoot.container,
      "input",
      "Display name",
    );
    const reasoningEffortSelect = getControlByLabel<HTMLSelectElement>(
      presetRoot.container,
      "select",
      "Reasoning effort",
    );
    const reasoningDisplaySelect = getControlByLabel<HTMLSelectElement>(
      presetRoot.container,
      "select",
      "Reasoning display",
    );
    const usePresetButton = Array.from(
      presetRoot.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Use selected preset"));
    const savePresetButton = Array.from(
      presetRoot.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Save model preset"));
    const backButton = Array.from(
      presetRoot.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Back");
    const cancelButton = Array.from(
      presetRoot.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Cancel"));

    act(() => {
      setSelectValue(savedPresetSelect!, "gpt-5-4");
      setControlledInputValue(displayNameInput!, "Agent Default");
      setSelectValue(reasoningEffortSelect!, "high");
      setSelectValue(reasoningDisplaySelect!, "hidden");
      click(usePresetButton!);
      click(savePresetButton!);
      click(backButton!);
      click(cancelButton!);
    });

    expect(onSelectedPresetKeyChange).toHaveBeenCalledWith("gpt-5-4");
    expect(onApplySelectedPreset).toHaveBeenCalledOnce();
    expect(onModelSave).toHaveBeenCalledOnce();
    expect(onBackToProvider).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onModelFilterChange).not.toHaveBeenCalled();
    expect(onModelStateChange).toHaveBeenCalledTimes(3);
    expect(modelStates[0]).toMatchObject({ displayName: "Agent Default" });
    expect(modelStates[1]).toMatchObject({ reasoningEffort: "high" });
    expect(modelStates[2]).toMatchObject({ reasoningVisibility: "hidden" });

    cleanupTestRoot(presetRoot);

    const agentRoot = renderIntoDocument(
      <AgentSetupWizard
        busy={false}
        hasPresetStep={false}
        hasProviderStep={false}
        mode="create_agent"
        onCancel={onCancel}
        step="agent"
        provider={{
          canSave: false,
          configuredProviders: [],
          filteredProviders: [],
          onProviderFilterChange: vi.fn(),
          onProviderSave: vi.fn(),
          onProviderSelectionChange: vi.fn(),
          onProviderStateChange: vi.fn(),
          providerFilter: "",
          providerFormError: null,
          providerState: {
            providerKey: "",
            methodKey: "",
            displayName: "",
            configValues: {},
            secretValues: {},
          },
          selectedMethod: undefined,
          selectedProvider: undefined,
        }}
        preset={{
          canApplySelectedPreset: false,
          canReturnToProvider: false,
          canSave: false,
          filteredAvailableModels: [],
          modelFilter: "",
          modelState: {
            displayName: "",
            modelRef: "",
            reasoningEffort: "",
            reasoningVisibility: "",
          },
          onApplySelectedPreset: vi.fn(),
          onBackToProvider: undefined,
          onModelFilterChange: vi.fn(),
          onModelSave: vi.fn(),
          onModelSelectionChange: vi.fn(),
          onModelStateChange: vi.fn(),
          onSelectedPresetKeyChange: vi.fn(),
          presets: [],
          selectedPresetKey: "",
        }}
        agent={{
          canSave: true,
          name: "New Agent",
          nameRequired: true,
          onBackToPreset,
          onNameChange,
          onRandomizeName,
          onSave,
          onToneChange,
          selectedPresetLabel: "GPT-5.4 (openrouter/openai/gpt-5.4)",
          showBackToPreset: false,
          showPresetSummary: false,
          tone: "direct",
        }}
      />,
    );

    const agentNameInput = getControlByLabel<HTMLInputElement>(
      agentRoot.container,
      "input",
      "Agent name",
    );
    const toneSelect = getControlByLabel<HTMLSelectElement>(agentRoot.container, "select", "Tone");
    const nameLabel = Array.from(
      agentRoot.container.querySelectorAll<HTMLLabelElement>("label"),
    ).find((label) => label.textContent?.includes("Agent name"));
    const randomizeButton = agentRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-create-randomize-name"]',
    );
    const agentCancelButton = Array.from(
      agentRoot.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Cancel"));
    const createButton = Array.from(
      agentRoot.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Create agent"));

    expect(nameLabel?.textContent).toContain("*");
    expect(
      Array.from(agentRoot.container.querySelectorAll<HTMLLabelElement>("label")).find((label) =>
        label.textContent?.includes("Model preset"),
      ),
    ).toBeUndefined();
    expect(
      Array.from(agentRoot.container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent === "Back",
      ),
    ).toBeUndefined();
    expect(randomizeButton).not.toBeNull();

    act(() => {
      setControlledInputValue(agentNameInput!, "Operations Agent");
      setSelectValue(toneSelect!, "warm");
      click(randomizeButton!);
      click(agentCancelButton!);
      click(createButton!);
    });

    expect(onNameChange).toHaveBeenCalledWith("Operations Agent");
    expect(onToneChange).toHaveBeenCalledWith("warm");
    expect(onRandomizeName).toHaveBeenCalledOnce();
    expect(onBackToPreset).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledOnce();

    cleanupTestRoot(agentRoot);
  });
});
