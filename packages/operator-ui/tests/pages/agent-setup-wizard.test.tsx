// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentSetupWizard } from "../../src/components/pages/agent-setup-wizard.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";
import { setControlledInputValue } from "../operator-ui.test-support.js";
import { getControlByLabel, setSelectValue } from "./agent-setup-wizard.test-support.js";

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
          onSave: vi.fn(),
          onToneChange: vi.fn(),
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
    expect(providerStates[2]).toMatchObject({ configValues: { use_proxy: true } });

    cleanupTestRoot(testRoot);
  });

  it("captures provider secret input values before deferred state updates run", () => {
    let providerState = {
      providerKey: "openrouter",
      methodKey: "api_key",
      displayName: "OpenRouter",
      configValues: {},
      secretValues: {},
    };
    let pendingProviderUpdate: ((current: typeof providerState) => typeof providerState) | null =
      null;
    const onProviderStateChange = vi.fn(
      (updater: (current: typeof providerState) => typeof providerState) => {
        pendingProviderUpdate = updater;
      },
    );

    const testRoot = renderIntoDocument(
      <AgentSetupWizard
        busy={false}
        mode="first_run"
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
              ],
            },
          ],
          onProviderFilterChange: vi.fn(),
          onProviderSave: vi.fn(),
          onProviderSelectionChange: vi.fn(),
          onProviderStateChange,
          providerFilter: "",
          providerFormError: null,
          providerState,
          selectedMethod: {
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
          onSave: vi.fn(),
          onToneChange: vi.fn(),
          selectedPresetLabel: "",
          tone: "direct",
        }}
      />,
    );

    const apiKeyInput = getControlByLabel<HTMLInputElement>(testRoot.container, "input", "API key");
    expect(apiKeyInput).not.toBeNull();

    act(() => {
      setControlledInputValue(apiKeyInput!, "sk-test-key");
    });

    expect(onProviderStateChange).toHaveBeenCalledOnce();
    expect(pendingProviderUpdate).not.toBeNull();

    expect(() => {
      providerState = pendingProviderUpdate!(providerState);
    }).not.toThrow();
    expect(providerState).toMatchObject({
      secretValues: {
        api_key: "sk-test-key",
      },
    });

    cleanupTestRoot(testRoot);
  });
});
