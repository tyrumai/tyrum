// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentSetupWizard } from "../../src/components/pages/agent-setup-wizard.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";
import { setControlledInputValue } from "../operator-ui.test-support.js";

function getControlByLabel<T extends HTMLElement>(
  root: HTMLElement,
  selector: "input" | "select",
  labelText: string,
): T | null {
  const label = Array.from(root.querySelectorAll<HTMLLabelElement>("label")).find((candidate) =>
    candidate.textContent?.includes(labelText),
  );
  if (!label?.htmlFor) return null;
  return root.querySelector<T>(`${selector}[id="${label.htmlFor}"]`);
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  descriptor?.set?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("AgentSetupWizard", () => {
  it("wires provider step form events in create-agent mode", async () => {
    const onCancel = vi.fn();
    const onProviderFilterChange = vi.fn();
    const onProviderSave = vi.fn();
    const onProviderSelectionChange = vi.fn();
    const providerStates: Array<Record<string, unknown>> = [];
    let providerState = {
      providerKey: "openrouter",
      methodKey: "oauth",
      displayName: "OpenRouter",
      configValues: { use_proxy: false },
      secretValues: {},
    };
    const onProviderStateChange = vi.fn(
      (updater: (current: typeof providerState) => typeof providerState) => {
        providerState = updater(providerState);
        providerStates.push(providerState);
      },
    );

    const testRoot = renderIntoDocument(
      <AgentSetupWizard
        busy={false}
        mode="create_agent"
        onCancel={onCancel}
        step="provider"
        provider={{
          canSave: true,
          configuredProviders: [],
          filteredProviders: [
            {
              provider_key: "openrouter",
              name: "OpenRouter",
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
                      description: "Secret key",
                      kind: "secret",
                      input: "password",
                      required: true,
                    },
                  ],
                },
                {
                  method_key: "oauth",
                  label: "OAuth",
                  type: "oauth",
                  fields: [
                    {
                      key: "use_proxy",
                      label: "Use proxy",
                      description: "Enable proxy routing",
                      kind: "config",
                      input: "boolean",
                      required: false,
                    },
                  ],
                },
              ],
            },
          ],
          onProviderFilterChange,
          onProviderSave,
          onProviderSelectionChange,
          onProviderStateChange,
          providerFilter: "",
          providerFormError: null,
          providerState,
          selectedMethod: {
            method_key: "oauth",
            label: "OAuth",
            type: "oauth",
            fields: [
              {
                key: "use_proxy",
                label: "Use proxy",
                description: "Enable proxy routing",
                kind: "config",
                input: "boolean",
                required: false,
              },
            ],
          },
          selectedProvider: {
            provider_key: "openrouter",
            name: "OpenRouter",
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
                    description: "Secret key",
                    kind: "secret",
                    input: "password",
                    required: true,
                  },
                ],
              },
              {
                method_key: "oauth",
                label: "OAuth",
                type: "oauth",
                fields: [
                  {
                    key: "use_proxy",
                    label: "Use proxy",
                    description: "Enable proxy routing",
                    kind: "config",
                    input: "boolean",
                    required: false,
                  },
                ],
              },
            ],
          },
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
          canSave: false,
          name: "",
          onBackToPreset: undefined,
          onNameChange: vi.fn(),
          onPolicyPresetChange: vi.fn(),
          onSave: vi.fn(),
          onToneChange: vi.fn(),
          policyPreset: "moderate",
          selectedPresetLabel: "",
          tone: "direct",
        }}
      />,
    );

    const displayNameInput = getControlByLabel<HTMLInputElement>(
      testRoot.container,
      "input",
      "Display name",
    );
    const authMethodSelect = getControlByLabel<HTMLSelectElement>(
      testRoot.container,
      "select",
      "Authentication method",
    );
    const providerFilterInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="providers-filter-input"]',
    );
    const proxyCheckbox = testRoot.container.querySelector<HTMLElement>('[role="checkbox"]');
    const saveButton = Array.from(
      testRoot.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Save provider account"));
    const cancelButton = Array.from(
      testRoot.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Cancel"));

    expect(displayNameInput).not.toBeNull();
    expect(authMethodSelect).not.toBeNull();
    expect(providerFilterInput).not.toBeNull();
    expect(proxyCheckbox).not.toBeNull();
    expect(saveButton).not.toBeNull();
    expect(cancelButton).not.toBeNull();

    act(() => {
      setControlledInputValue(providerFilterInput!, "router");
      setControlledInputValue(displayNameInput!, "Shared Provider");
      setSelectValue(authMethodSelect!, "api_key");
      click(proxyCheckbox!);
      click(saveButton!);
      click(cancelButton!);
    });

    expect(onProviderFilterChange).toHaveBeenCalledWith("router");
    expect(onProviderSave).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onProviderStateChange).toHaveBeenCalledTimes(3);
    expect(providerStates[0]).toMatchObject({ displayName: "Shared Provider" });
    expect(providerStates[1]).toMatchObject({
      displayName: "Shared Provider",
      methodKey: "api_key",
      configValues: {},
      secretValues: {},
    });
    expect(providerStates[2]).toMatchObject({
      configValues: { use_proxy: true },
    });

    cleanupTestRoot(testRoot);
  });

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
    const onPolicyPresetChange = vi.fn();
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
          onPolicyPresetChange: vi.fn(),
          onSave: vi.fn(),
          onToneChange: vi.fn(),
          policyPreset: "moderate",
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
          onBackToPreset,
          onNameChange,
          onPolicyPresetChange,
          onSave,
          onToneChange,
          policyPreset: "moderate",
          selectedPresetLabel: "GPT-5.4 (openrouter/openai/gpt-5.4)",
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
    const powerUserLabel = Array.from(
      agentRoot.container.querySelectorAll<HTMLLabelElement>("label"),
    ).find((label) => label.textContent?.includes("Power user"));
    const agentBackButton = Array.from(
      agentRoot.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "Back");
    const createButton = Array.from(
      agentRoot.container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Create agent"));

    act(() => {
      setControlledInputValue(agentNameInput!, "Operations Agent");
      setSelectValue(toneSelect!, "warm");
      click(powerUserLabel!);
      click(agentBackButton!);
      click(cancelButton!);
      click(createButton!);
    });

    expect(onNameChange).toHaveBeenCalledWith("Operations Agent");
    expect(onToneChange).toHaveBeenCalledWith("warm");
    expect(onPolicyPresetChange).toHaveBeenCalledWith("power_user");
    expect(onBackToPreset).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();

    cleanupTestRoot(agentRoot);
  });
});
