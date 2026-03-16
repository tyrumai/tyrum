import { ShieldCheck } from "lucide-react";
import type * as React from "react";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import {
  getFieldBooleanValue,
  getFieldStringValue,
  type ProviderFormState,
  type ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";
import {
  EXECUTION_PROFILE_IDS,
  EXECUTION_PROFILE_LABELS,
  REASONING_OPTIONS,
  REASONING_VISIBILITY_OPTIONS,
  type ModelDialogState,
  type ModelPreset,
} from "./admin-http-models.shared.js";
import { OnboardingStepFrame } from "./first-run-onboarding.parts.js";

export function OnboardingDoneStep({
  onClose,
  onMarkCompleted,
  onNavigate,
}: {
  onClose: () => void;
  onMarkCompleted: () => void;
  onNavigate: (routeId: "agents" | "configure" | "dashboard") => void;
}): React.ReactElement {
  const navigate = (routeId: "agents" | "configure" | "dashboard") => {
    onMarkCompleted();
    onClose();
    onNavigate(routeId);
  };

  return (
    <div className="grid gap-4" data-testid="first-run-onboarding-step-done">
      <Alert
        variant="success"
        title="Initial setup complete"
        description="Tyrum is configured and ready to use."
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => navigate("dashboard")}>
          Dashboard
        </Button>
        <Button type="button" variant="secondary" onClick={() => navigate("configure")}>
          Configure
        </Button>
        <Button type="button" variant="secondary" onClick={() => navigate("agents")}>
          Agents
        </Button>
      </div>
    </div>
  );
}

export function OnboardingAdminStep({
  busy,
  enterAdminAccess,
}: {
  busy: boolean;
  enterAdminAccess: () => void;
}): React.ReactElement {
  return (
    <OnboardingStepFrame stepId="admin">
      <div className="grid gap-4" data-testid="first-run-onboarding-step-admin">
        <div className="grid gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-4">
          <div className="text-sm font-medium text-fg">Temporary admin access is required.</div>
          <div className="text-sm text-fg-muted">
            Tyrum needs one elevated session to save the initial configuration safely.
          </div>
        </div>
        <Button
          type="button"
          variant="warning"
          size="lg"
          className="w-full justify-center sm:w-auto"
          data-testid="first-run-onboarding-admin-access"
          isLoading={busy}
          onClick={enterAdminAccess}
        >
          <ShieldCheck className="h-4 w-4" />
          Authorize admin access
        </Button>
      </div>
    </OnboardingStepFrame>
  );
}

export function OnboardingProviderStep({
  busy,
  canSave,
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
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="Filter providers"
            value={providerFilter}
            onChange={(event) => onProviderFilterChange(event.currentTarget.value)}
            placeholder="Search providers"
          />
          <Select
            label="Provider"
            value={providerState.providerKey}
            onChange={(event) => onProviderSelectionChange(event.currentTarget.value)}
          >
            {filteredProviders.map((provider) => (
              <option key={provider.provider_key} value={provider.provider_key}>
                {provider.name}
              </option>
            ))}
          </Select>
          <Select
            label="Authentication method"
            value={providerState.methodKey}
            onChange={(event) => {
              const nextMethod = selectedProvider?.methods.find(
                (method) => method.method_key === event.currentTarget.value,
              );
              onProviderStateChange((current) => ({
                ...current,
                methodKey: event.currentTarget.value,
                configValues: nextMethod
                  ? Object.fromEntries(
                      nextMethod.fields
                        .filter((field) => field.kind === "config" && field.input === "boolean")
                        .map((field) => [field.key, false]),
                    )
                  : {},
                secretValues: {},
              }));
            }}
          >
            {(selectedProvider?.methods ?? []).map((method) => (
              <option key={method.method_key} value={method.method_key}>
                {method.label}
              </option>
            ))}
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
        {(selectedRegistryProvider?.fields ?? []).map((field) => {
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
        })}
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
  availableModels,
  busy,
  canSave,
  modelState,
  onModelSave,
  onModelStateChange,
}: {
  availableModels: Array<{
    modelRef: string;
    label: string;
    modelName: string;
  }>;
  busy: boolean;
  canSave: boolean;
  modelState: ModelDialogState;
  onModelSave: () => void;
  onModelStateChange: (updater: (current: ModelDialogState) => ModelDialogState) => void;
}): React.ReactElement {
  return (
    <OnboardingStepFrame stepId="preset">
      <div className="grid gap-4" data-testid="first-run-onboarding-step-preset">
        <div className="grid gap-4 md:grid-cols-2">
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
          <Select
            label="Model"
            value={modelState.modelRef}
            onChange={(event) => {
              onModelStateChange((current) => ({
                ...current,
                modelRef: event.currentTarget.value,
                displayName:
                  current.displayName.trim().length > 0
                    ? current.displayName
                    : (availableModels.find((model) => model.modelRef === event.currentTarget.value)
                        ?.modelName ?? current.displayName),
              }));
            }}
          >
            {availableModels.map((model) => (
              <option key={model.modelRef} value={model.modelRef}>
                {model.label}
              </option>
            ))}
          </Select>
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

export function OnboardingAssignmentsStep({
  assignmentDraft,
  busy,
  canSave,
  onApplyPresetToAll,
  onAssignmentChange,
  onAssignmentSave,
  onPresetChange,
  presets,
  selectedPresetKey,
}: {
  assignmentDraft: Record<string, string | null>;
  busy: boolean;
  canSave: boolean;
  onApplyPresetToAll: () => void;
  onAssignmentChange: (profileId: string, presetKey: string | null) => void;
  onAssignmentSave: () => void;
  onPresetChange: (presetKey: string) => void;
  presets: readonly ModelPreset[];
  selectedPresetKey: string;
}): React.ReactElement {
  return (
    <OnboardingStepFrame stepId="assignments">
      <div className="grid gap-4" data-testid="first-run-onboarding-step-assignments">
        <Select
          label="Preset to apply"
          value={selectedPresetKey}
          onChange={(event) => onPresetChange(event.currentTarget.value)}
        >
          {presets.map((preset) => (
            <option key={preset.preset_key} value={preset.preset_key}>
              {preset.display_name} ({preset.provider_key}/{preset.model_id})
            </option>
          ))}
        </Select>
        <div className="grid gap-3 md:grid-cols-2">
          {EXECUTION_PROFILE_IDS.map((profileId) => (
            <Select
              key={profileId}
              label={EXECUTION_PROFILE_LABELS[profileId]}
              value={assignmentDraft[profileId] ?? ""}
              onChange={(event) => onAssignmentChange(profileId, event.currentTarget.value || null)}
            >
              <option value="">None</option>
              {presets.map((preset) => (
                <option key={preset.preset_key} value={preset.preset_key}>
                  {preset.display_name}
                </option>
              ))}
            </Select>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onApplyPresetToAll}>
            Apply preset to all profiles
          </Button>
          <Button
            type="button"
            isLoading={busy}
            disabled={!canSave || !selectedPresetKey}
            onClick={onAssignmentSave}
          >
            Save assignments
          </Button>
        </div>
      </div>
    </OnboardingStepFrame>
  );
}

export function OnboardingAgentStep({
  busy,
  canSave,
  currentModel,
  onAgentSave,
  onPresetChange,
  presets,
  selectedPresetKey,
}: {
  busy: boolean;
  canSave: boolean;
  currentModel: string;
  onAgentSave: () => void;
  onPresetChange: (presetKey: string) => void;
  presets: readonly ModelPreset[];
  selectedPresetKey: string;
}): React.ReactElement {
  return (
    <OnboardingStepFrame stepId="agent">
      <div className="grid gap-4" data-testid="first-run-onboarding-step-agent">
        <div className="grid gap-4 md:grid-cols-2">
          <Select
            label="Preset"
            value={selectedPresetKey}
            onChange={(event) => onPresetChange(event.currentTarget.value)}
          >
            {presets.map((preset) => (
              <option key={preset.preset_key} value={preset.preset_key}>
                {preset.display_name} ({preset.provider_key}/{preset.model_id})
              </option>
            ))}
          </Select>
          <Input label="Current default agent model" readOnly value={currentModel} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" isLoading={busy} disabled={!canSave} onClick={onAgentSave}>
            Save default agent
          </Button>
        </div>
      </div>
    </OnboardingStepFrame>
  );
}
