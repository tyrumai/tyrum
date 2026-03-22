import { PERSONA_TONES } from "@tyrum/contracts";
import type * as React from "react";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import {
  getBooleanConfigDefaults,
  getFieldBooleanValue,
  getFieldStringValue,
  type ConfiguredProviderGroup,
  type ProviderFormState,
  type ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";
import {
  REASONING_OPTIONS,
  REASONING_VISIBILITY_OPTIONS,
  type AvailableModel,
  type ModelDialogState,
  type ModelPreset,
} from "./admin-http-models.shared.js";
import { ModelPickerField } from "./model-picker-field.js";
import { OnboardingStepFrame } from "./first-run-onboarding.parts.js";
import { ProviderPickerField } from "./provider-picker-field.js";
import {
  WORKSPACE_POLICY_PRESET_OPTIONS,
  type WorkspacePolicyPresetKey,
} from "./workspace-policy-presets.js";

export function OnboardingProviderStep({
  busy,
  canSave,
  configuredProviders,
  filteredProviders,
  onProviderFilterChange,
  onProviderSave,
  onProviderSelectionChange,
  onProviderStateChange,
  providerFilter,
  providerFormError,
  providerState,
  selectedProvider,
  selectedRegistryProvider,
}: {
  busy: boolean;
  canSave: boolean;
  configuredProviders: ConfiguredProviderGroup[];
  filteredProviders: ProviderRegistryEntry[];
  onProviderFilterChange: (value: string) => void;
  onProviderSave: () => void;
  onProviderSelectionChange: (providerKey: string) => void;
  onProviderStateChange: (updater: (current: ProviderFormState) => ProviderFormState) => void;
  providerFilter: string;
  providerFormError: string | null;
  providerState: ProviderFormState;
  selectedProvider: ProviderRegistryEntry | undefined;
  selectedRegistryProvider: ProviderRegistryEntry["methods"][number] | undefined;
}): React.ReactElement {
  return (
    <OnboardingStepFrame stepId="provider">
      <div className="grid gap-4" data-testid="first-run-onboarding-step-provider">
        <ProviderPickerField
          configuredProviders={configuredProviders}
          filteredProviders={filteredProviders}
          onProviderFilterChange={onProviderFilterChange}
          onSelectProvider={onProviderSelectionChange}
          providerFilter={providerFilter}
          selectedProviderKey={providerState.providerKey}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Authentication method"
            value={providerState.methodKey}
            onChange={(event) => {
              const nextMethod = selectedProvider?.methods.find(
                (method: ProviderRegistryEntry["methods"][number]) =>
                  method.method_key === event.currentTarget.value,
              );
              onProviderStateChange((current) => ({
                ...current,
                methodKey: event.currentTarget.value,
                configValues: getBooleanConfigDefaults(nextMethod),
                secretValues: {},
              }));
            }}
          >
            {(selectedProvider?.methods ?? []).map(
              (method: ProviderRegistryEntry["methods"][number]) => (
                <option key={method.method_key} value={method.method_key}>
                  {method.label}
                </option>
              ),
            )}
          </Select>
          <Input
            label="Display name"
            value={providerState.displayName}
            onChange={(event) => {
              onProviderStateChange((current) => ({
                ...current,
                displayName: event.currentTarget.value,
              }));
            }}
          />
        </div>
        {!selectedProvider ? (
          <Alert
            variant="warning"
            title="No supported providers available"
            description="The model catalog does not currently expose any supported provider setup flows."
          />
        ) : null}
        {(selectedRegistryProvider?.fields ?? []).map(
          (field: ProviderRegistryEntry["methods"][number]["fields"][number]) => {
            if (field.kind === "config" && field.input === "boolean") {
              return (
                <label
                  key={field.key}
                  className="flex items-start gap-3 rounded-lg border border-border/70 px-3 py-3"
                >
                  <Checkbox
                    checked={getFieldBooleanValue(providerState.configValues[field.key])}
                    onCheckedChange={(checked) => {
                      onProviderStateChange((current) => ({
                        ...current,
                        configValues: {
                          ...current.configValues,
                          [field.key]: checked === true,
                        },
                      }));
                    }}
                  />
                  <div className="grid gap-1">
                    <div className="text-sm font-medium text-fg">{field.label}</div>
                    {field.description ? (
                      <div className="text-xs text-fg-muted">{field.description}</div>
                    ) : null}
                  </div>
                </label>
              );
            }

            const isSecret = field.kind === "secret";
            return (
              <Input
                key={field.key}
                label={field.label}
                type={isSecret ? "password" : "text"}
                required={field.required}
                value={
                  isSecret
                    ? getFieldStringValue(providerState.secretValues[field.key])
                    : getFieldStringValue(providerState.configValues[field.key])
                }
                onChange={(event) => {
                  onProviderStateChange((current) => ({
                    ...current,
                    ...(isSecret
                      ? {
                          secretValues: {
                            ...current.secretValues,
                            [field.key]: event.currentTarget.value,
                          },
                        }
                      : {
                          configValues: {
                            ...current.configValues,
                            [field.key]: event.currentTarget.value,
                          },
                        }),
                  }));
                }}
                helperText={field.description ?? undefined}
              />
            );
          },
        )}
        {providerFormError ? (
          <Alert
            variant="warning"
            title="Provider form incomplete"
            description={providerFormError}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            isLoading={busy}
            disabled={!canSave || Boolean(providerFormError)}
            onClick={onProviderSave}
          >
            Save provider account
          </Button>
        </div>
      </div>
    </OnboardingStepFrame>
  );
}

export function OnboardingPresetStep({
  filteredAvailableModels,
  busy,
  canSave,
  modelFilter,
  modelState,
  onApplySelectedPreset,
  onModelFilterChange,
  onModelSave,
  onModelSelectionChange,
  onModelStateChange,
  onSelectedPresetKeyChange,
  presets,
  selectedPresetKey,
}: {
  filteredAvailableModels: AvailableModel[];
  busy: boolean;
  canSave: boolean;
  modelFilter: string;
  modelState: ModelDialogState;
  onApplySelectedPreset: () => void;
  onModelFilterChange: (value: string) => void;
  onModelSave: () => void;
  onModelSelectionChange: (modelRef: string) => void;
  onModelStateChange: (updater: (current: ModelDialogState) => ModelDialogState) => void;
  onSelectedPresetKeyChange: (value: string) => void;
  presets: readonly ModelPreset[];
  selectedPresetKey: string;
}): React.ReactElement {
  return (
    <OnboardingStepFrame stepId="preset">
      <div className="grid gap-4" data-testid="first-run-onboarding-step-preset">
        {presets.length > 0 ? (
          <div className="grid gap-3 rounded-xl border border-border/70 bg-bg-subtle/30 p-4">
            <Select
              label="Saved preset"
              value={selectedPresetKey}
              onChange={(event) => onSelectedPresetKeyChange(event.currentTarget.value)}
            >
              {presets.map((preset) => (
                <option key={preset.preset_key} value={preset.preset_key}>
                  {preset.display_name} ({preset.provider_key}/{preset.model_id})
                </option>
              ))}
            </Select>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                isLoading={busy}
                disabled={!canSave || !selectedPresetKey}
                onClick={onApplySelectedPreset}
              >
                Use selected preset
              </Button>
              <div className="text-xs text-fg-muted">
                This applies the preset to all built-in execution profiles automatically.
              </div>
            </div>
          </div>
        ) : null}
        <Input
          label="Display name"
          value={modelState.displayName}
          onChange={(event) => {
            onModelStateChange((current) => ({
              ...current,
              displayName: event.currentTarget.value,
            }));
          }}
        />
        <ModelPickerField
          filteredModels={filteredAvailableModels}
          modelFilter={modelFilter}
          onModelFilterChange={onModelFilterChange}
          onSelectModel={onModelSelectionChange}
          selectedModelRef={modelState.modelRef}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Reasoning effort"
            value={modelState.reasoningEffort}
            onChange={(event) => {
              onModelStateChange((current) => ({
                ...current,
                reasoningEffort: event.currentTarget.value as ModelDialogState["reasoningEffort"],
              }));
            }}
          >
            {REASONING_OPTIONS.map((option) => (
              <option key={option.value || "default"} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select
            label="Reasoning display"
            value={modelState.reasoningVisibility}
            onChange={(event) => {
              onModelStateChange((current) => ({
                ...current,
                reasoningVisibility: event.currentTarget
                  .value as ModelDialogState["reasoningVisibility"],
              }));
            }}
          >
            {REASONING_VISIBILITY_OPTIONS.map((option) => (
              <option key={option.value || "default"} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            isLoading={busy}
            disabled={!canSave || !modelState.displayName.trim() || !modelState.modelRef}
            onClick={onModelSave}
          >
            Save model preset
          </Button>
        </div>
      </div>
    </OnboardingStepFrame>
  );
}

export function OnboardingWorkspacePolicyStep({
  busy,
  canSave,
  onSave,
  onSelectionChange,
  selectedPreset,
}: {
  busy: boolean;
  canSave: boolean;
  onSave: () => void;
  onSelectionChange: (value: WorkspacePolicyPresetKey) => void;
  selectedPreset: WorkspacePolicyPresetKey;
}): React.ReactElement {
  return (
    <OnboardingStepFrame stepId="workspace_policy">
      <div className="grid gap-4" data-testid="first-run-onboarding-step-workspace-policy">
        <div className="grid gap-3">
          {WORKSPACE_POLICY_PRESET_OPTIONS.map((option) => {
            const isSelected = option.key === selectedPreset;
            return (
              <button
                key={option.key}
                type="button"
                className={`grid gap-1 rounded-xl border px-4 py-4 text-left transition-colors ${
                  isSelected
                    ? "border-primary/50 bg-primary-dim/20"
                    : "border-border/70 bg-bg hover:bg-bg-subtle"
                }`}
                data-testid={`first-run-onboarding-workspace-policy-${option.key}`}
                onClick={() => onSelectionChange(option.key)}
              >
                <div className="text-sm font-medium text-fg">{option.label}</div>
                <div className="text-xs text-fg-muted">{option.description}</div>
              </button>
            );
          })}
        </div>
        <Alert
          variant="info"
          title="Workspace policy applies to every new agent"
          description="Choose the baseline once here. Agents created later inherit this workspace-wide policy."
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" isLoading={busy} disabled={!canSave} onClick={onSave}>
            Save workspace policy
          </Button>
        </div>
      </div>
    </OnboardingStepFrame>
  );
}

export function OnboardingAgentStep({
  busy,
  canSave,
  name,
  onAgentSave,
  onNameChange,
  onToneChange,
  selectedPresetLabel,
  tone,
}: {
  busy: boolean;
  canSave: boolean;
  name: string;
  onAgentSave: () => void;
  onNameChange: (value: string) => void;
  onToneChange: (value: string) => void;
  selectedPresetLabel: string;
  tone: string;
}): React.ReactElement {
  return (
    <OnboardingStepFrame stepId="agent">
      <div className="grid gap-4" data-testid="first-run-onboarding-step-agent">
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="Agent name"
            value={name}
            onChange={(event) => onNameChange(event.currentTarget.value)}
          />
          <Select
            label="Tone"
            value={tone}
            onChange={(event) => onToneChange(event.currentTarget.value)}
          >
            {PERSONA_TONES.map((toneOption: string) => (
              <option key={toneOption} value={toneOption}>
                {toneOption}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Model preset" readOnly value={selectedPresetLabel} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            isLoading={busy}
            disabled={!canSave || !name.trim() || !tone.trim()}
            onClick={onAgentSave}
          >
            Save agent
          </Button>
        </div>
      </div>
    </OnboardingStepFrame>
  );
}
