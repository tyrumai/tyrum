import { PERSONA_TONES } from "@tyrum/contracts";
import type * as React from "react";
import { Button } from "../ui/button.js";
import { Alert } from "../ui/alert.js";
import { Checkbox } from "../ui/checkbox.js";
import { Input } from "../ui/input.js";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.js";
import { Select } from "../ui/select.js";
import { ModelPickerField } from "./model-picker-field.js";
import { ProviderPickerField } from "./provider-picker-field.js";
import {
  REASONING_OPTIONS,
  REASONING_VISIBILITY_OPTIONS,
  type AvailableModel,
  type ModelDialogState,
  type ModelPreset,
} from "./admin-http-models.shared.js";
import {
  getBooleanConfigDefaults,
  getFieldBooleanValue,
  getFieldStringValue,
  type ConfiguredProviderGroup,
  type ProviderFormState,
  type ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";
import {
  agentSetupWizardTestId,
  AgentSetupStepFrame,
  AGENT_POLICY_PRESET_OPTIONS,
  buildAgentSetupStepMeta,
  type AgentPolicyPresetKey,
  type AgentSetupWizardMode,
  type AgentSetupWizardStep,
} from "./agent-setup-wizard.shared.js";

type ProviderStepProps = {
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
  selectedMethod: ProviderRegistryEntry["methods"][number] | undefined;
  selectedProvider: ProviderRegistryEntry | undefined;
};

type PresetStepProps = {
  canApplySelectedPreset: boolean;
  canReturnToProvider: boolean;
  canSave: boolean;
  filteredAvailableModels: AvailableModel[];
  modelFilter: string;
  modelState: ModelDialogState;
  onApplySelectedPreset: () => void;
  onBackToProvider?: () => void;
  onModelFilterChange: (value: string) => void;
  onModelSave: () => void;
  onModelSelectionChange: (modelRef: string) => void;
  onModelStateChange: (updater: (current: ModelDialogState) => ModelDialogState) => void;
  onSelectedPresetKeyChange: (value: string) => void;
  presets: readonly ModelPreset[];
  selectedPresetKey: string;
};

type AgentStepProps = {
  canSave: boolean;
  name: string;
  onBackToPreset?: () => void;
  onNameChange: (value: string) => void;
  onPolicyPresetChange: (value: AgentPolicyPresetKey) => void;
  onSave: () => void;
  onToneChange: (value: string) => void;
  policyPreset: AgentPolicyPresetKey;
  selectedPresetLabel: string;
  tone: string;
};

export type AgentSetupWizardProps = {
  busy: boolean;
  mode: AgentSetupWizardMode;
  onCancel?: () => void;
  step: AgentSetupWizardStep;
  provider: ProviderStepProps;
  preset: PresetStepProps;
  agent: AgentStepProps;
};

export function AgentSetupWizard({
  agent,
  busy,
  mode,
  onCancel,
  preset,
  provider,
  step,
}: AgentSetupWizardProps): React.ReactElement {
  const meta = buildAgentSetupStepMeta({
    canReturnToProvider: preset.canReturnToProvider,
    mode,
    step,
  });
  const showCancel = mode === "create_agent" && onCancel !== undefined;
  const showBackToProvider = mode === "create_agent" && preset.canReturnToProvider;
  const showBackToPreset = mode === "create_agent";

  if (step === "provider") {
    return (
      <AgentSetupStepFrame meta={meta}>
        <div className="grid gap-4" data-testid={agentSetupWizardTestId(mode, "provider")}>
          <ProviderPickerField
            configuredProviders={provider.configuredProviders}
            filteredProviders={provider.filteredProviders}
            onProviderFilterChange={provider.onProviderFilterChange}
            onSelectProvider={provider.onProviderSelectionChange}
            providerFilter={provider.providerFilter}
            selectedProviderKey={provider.providerState.providerKey}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Authentication method"
              value={provider.providerState.methodKey}
              onChange={(event) => {
                const nextMethod = provider.selectedProvider?.methods.find(
                  (method) => method.method_key === event.currentTarget.value,
                );
                provider.onProviderStateChange((current) => ({
                  ...current,
                  methodKey: event.currentTarget.value,
                  configValues: getBooleanConfigDefaults(nextMethod),
                  secretValues: {},
                }));
              }}
            >
              {(provider.selectedProvider?.methods ?? []).map((method) => (
                <option key={method.method_key} value={method.method_key}>
                  {method.label}
                </option>
              ))}
            </Select>
            <Input
              label="Display name"
              value={provider.providerState.displayName}
              onChange={(event) => {
                provider.onProviderStateChange((current) => ({
                  ...current,
                  displayName: event.currentTarget.value,
                }));
              }}
            />
          </div>
          {!provider.selectedProvider ? (
            <Alert
              variant="warning"
              title="No supported providers available"
              description="The model catalog does not currently expose any supported provider setup flows."
            />
          ) : null}
          {(provider.selectedMethod?.fields ?? []).map((field) => {
            if (field.kind === "config" && field.input === "boolean") {
              return (
                <label
                  key={field.key}
                  className="flex items-start gap-3 rounded-lg border border-border/70 px-3 py-3"
                >
                  <Checkbox
                    checked={getFieldBooleanValue(provider.providerState.configValues[field.key])}
                    onCheckedChange={(checked) => {
                      provider.onProviderStateChange((current) => ({
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
                    ? getFieldStringValue(provider.providerState.secretValues[field.key])
                    : getFieldStringValue(provider.providerState.configValues[field.key])
                }
                onChange={(event) => {
                  provider.onProviderStateChange((current) => ({
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
          })}
          {provider.providerFormError ? (
            <Alert
              variant="warning"
              title="Provider form incomplete"
              description={provider.providerFormError}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            {showCancel ? (
              <Button type="button" variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
            <Button
              type="button"
              isLoading={busy}
              disabled={!provider.canSave || Boolean(provider.providerFormError)}
              onClick={provider.onProviderSave}
            >
              Save provider account
            </Button>
          </div>
        </div>
      </AgentSetupStepFrame>
    );
  }

  if (step === "preset") {
    return (
      <AgentSetupStepFrame meta={meta}>
        <div className="grid gap-4" data-testid={agentSetupWizardTestId(mode, "preset")}>
          {preset.presets.length > 0 ? (
            <div className="grid gap-3 rounded-xl border border-border/70 bg-bg-subtle/30 p-4">
              <Select
                label="Saved preset"
                value={preset.selectedPresetKey}
                onChange={(event) => preset.onSelectedPresetKeyChange(event.currentTarget.value)}
              >
                {preset.presets.map((item) => (
                  <option key={item.preset_key} value={item.preset_key}>
                    {item.display_name} ({item.provider_key}/{item.model_id})
                  </option>
                ))}
              </Select>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  isLoading={busy}
                  disabled={!preset.canApplySelectedPreset || !preset.selectedPresetKey}
                  onClick={preset.onApplySelectedPreset}
                >
                  Use selected preset
                </Button>
                <div className="text-xs text-fg-muted">
                  {mode === "first_run"
                    ? "This applies the preset to all built-in execution profiles automatically."
                    : "This preset only configures the new agent."}
                </div>
              </div>
            </div>
          ) : null}
          <Input
            label="Display name"
            value={preset.modelState.displayName}
            onChange={(event) => {
              preset.onModelStateChange((current) => ({
                ...current,
                displayName: event.currentTarget.value,
              }));
            }}
          />
          <ModelPickerField
            filteredModels={preset.filteredAvailableModels}
            modelFilter={preset.modelFilter}
            onModelFilterChange={preset.onModelFilterChange}
            onSelectModel={preset.onModelSelectionChange}
            selectedModelRef={preset.modelState.modelRef}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              label="Reasoning effort"
              value={preset.modelState.reasoningEffort}
              onChange={(event) => {
                preset.onModelStateChange((current) => ({
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
              value={preset.modelState.reasoningVisibility}
              onChange={(event) => {
                preset.onModelStateChange((current) => ({
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
            {showBackToProvider && preset.onBackToProvider ? (
              <Button type="button" variant="secondary" onClick={preset.onBackToProvider}>
                Back
              </Button>
            ) : null}
            {showCancel ? (
              <Button type="button" variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
            <Button
              type="button"
              isLoading={busy}
              disabled={
                !preset.canSave ||
                !preset.modelState.displayName.trim() ||
                !preset.modelState.modelRef
              }
              onClick={preset.onModelSave}
            >
              Save model preset
            </Button>
          </div>
        </div>
      </AgentSetupStepFrame>
    );
  }

  return (
    <AgentSetupStepFrame meta={meta}>
      <div className="grid gap-4" data-testid={agentSetupWizardTestId(mode, "agent")}>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            data-testid={mode === "create_agent" ? "agents-create-name" : undefined}
            label="Agent name"
            value={agent.name}
            onChange={(event) => agent.onNameChange(event.currentTarget.value)}
          />
          <Select
            label="Tone"
            value={agent.tone}
            onChange={(event) => agent.onToneChange(event.currentTarget.value)}
          >
            {PERSONA_TONES.map((toneOption) => (
              <option key={toneOption} value={toneOption}>
                {toneOption}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Model preset" readOnly value={agent.selectedPresetLabel} />
        </div>
        <div className="grid gap-3">
          <div className="text-sm font-medium text-fg">Agent policy preset</div>
          <RadioGroup
            value={agent.policyPreset}
            onValueChange={(value) => agent.onPolicyPresetChange(value as AgentPolicyPresetKey)}
          >
            {AGENT_POLICY_PRESET_OPTIONS.map((option) => (
              <label
                key={option.key}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 px-4 py-3"
              >
                <RadioGroupItem value={option.key} />
                <div className="grid gap-1">
                  <div className="text-sm font-medium text-fg">{option.label}</div>
                  <div className="text-xs text-fg-muted">{option.description}</div>
                </div>
              </label>
            ))}
          </RadioGroup>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showBackToPreset && agent.onBackToPreset ? (
            <Button type="button" variant="secondary" onClick={agent.onBackToPreset}>
              Back
            </Button>
          ) : null}
          {showCancel ? (
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button
            type="button"
            data-testid={mode === "create_agent" ? "agents-create-save" : undefined}
            isLoading={busy}
            disabled={!agent.canSave || !agent.name.trim() || !agent.tone.trim()}
            onClick={agent.onSave}
          >
            {mode === "create_agent" ? "Create agent" : "Save agent"}
          </Button>
        </div>
      </div>
    </AgentSetupStepFrame>
  );
}
