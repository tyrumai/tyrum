import type * as React from "react";
import type { AdminAccessMode } from "../../hooks/use-admin-access-mode.js";
import type { ColorPalette, ThemeMode } from "../../hooks/use-theme.js";
import { LoadingState } from "../ui/loading-state.js";
import { AgentSetupWizard } from "./agent-setup-wizard.js";
import type { ModelPreset } from "./admin-http-models.shared.js";
import type { AdminHttpClient } from "./admin-http-shared.js";
import {
  OnboardingAdminStep,
  OnboardingCompletionStep,
  OnboardingPaletteStep,
} from "./first-run-onboarding.intro.js";
import type { OnboardingDataState } from "./first-run-onboarding.logic.js";
import { OnboardingWorkspacePolicyStep } from "./first-run-onboarding.sections.js";
import type { FirstRunOnboardingStepId } from "./first-run-onboarding.shared.js";

type OnboardingDraftState = ReturnType<
  typeof import("./first-run-onboarding.logic.js").useOnboardingDrafts
>;

export function FirstRunOnboardingStepContent({
  canMutate,
  data,
  drafts,
  mutationHttp,
  onAdminContinue,
  onAgentSave,
  onRandomizeAgentName,
  onClose,
  onNavigate,
  onPaletteContinue,
  onPresetApply,
  onPresetSave,
  onProviderSave,
  onSelectModel,
  onSelectAdminAccessMode,
  onSelectMode,
  onSelectPalette,
  onSelectProvider,
  onWorkspacePolicySave,
  providerFormError,
  selectedAdminAccessMode,
  selectedMode,
  selectedPalette,
  selectedPreset,
  selectedPresetLabel,
  step,
  submitBusy,
}: {
  canMutate: boolean;
  data: OnboardingDataState;
  drafts: OnboardingDraftState;
  mutationHttp: AdminHttpClient | null;
  onAdminContinue: () => void;
  onAgentSave: () => void;
  onRandomizeAgentName: () => void;
  onClose: () => void;
  onNavigate: (routeId: "agents" | "configure" | "dashboard") => void;
  onPaletteContinue: () => void;
  onPresetApply: () => void;
  onPresetSave: () => void;
  onProviderSave: () => void;
  onSelectModel: (modelRef: string) => void;
  onSelectAdminAccessMode: (mode: AdminAccessMode) => void;
  onSelectMode: (mode: ThemeMode) => void;
  onSelectPalette: (palette: ColorPalette) => void;
  onSelectProvider: (providerKey: string) => void;
  onWorkspacePolicySave: () => void;
  providerFormError: string | null;
  selectedAdminAccessMode: AdminAccessMode;
  selectedMode: ThemeMode;
  selectedPalette: ColorPalette;
  selectedPreset: ModelPreset | null;
  selectedPresetLabel: string;
  step: FirstRunOnboardingStepId;
  submitBusy: boolean;
}): React.ReactElement {
  if (data.loading) {
    return <LoadingState label="Loading onboarding state…" />;
  }
  if (step === "done") {
    return <OnboardingCompletionStep onClose={onClose} onNavigate={onNavigate} />;
  }
  if (step === "palette") {
    return (
      <OnboardingPaletteStep
        selectedMode={selectedMode}
        selectedPalette={selectedPalette}
        onSelectMode={onSelectMode}
        onSelectPalette={onSelectPalette}
        onContinue={onPaletteContinue}
      />
    );
  }
  if (step === "admin") {
    return (
      <OnboardingAdminStep
        busy={submitBusy}
        canMutate={canMutate}
        selectedMode={selectedAdminAccessMode}
        onModeChange={onSelectAdminAccessMode}
        continueWithAdminAccess={onAdminContinue}
      />
    );
  }
  if (step === "provider") {
    return (
      <AgentSetupWizard
        busy={submitBusy}
        mode="first_run"
        step="provider"
        provider={{
          canSave: Boolean(mutationHttp),
          configuredProviders: data.providers,
          filteredProviders: drafts.filteredProviders,
          onProviderFilterChange: drafts.setProviderFilter,
          onProviderSave,
          onProviderSelectionChange: onSelectProvider,
          onProviderStateChange: drafts.setProviderState,
          providerFilter: drafts.providerFilter,
          providerFormError,
          providerState: drafts.providerState,
          selectedMethod: drafts.selectedMethod,
          selectedProvider: drafts.selectedProvider,
        }}
        preset={{
          canApplySelectedPreset: false,
          canReturnToProvider: false,
          canSave: false,
          filteredAvailableModels: [],
          modelFilter: "",
          modelState: drafts.modelState,
          onApplySelectedPreset: () => {},
          onModelFilterChange: () => {},
          onModelSave: () => {},
          onModelSelectionChange: () => {},
          onModelStateChange: () => {},
          onSelectedPresetKeyChange: () => {},
          presets: [],
          selectedPresetKey: "",
        }}
        agent={{
          canSave: false,
          name: drafts.agentName,
          onNameChange: drafts.setAgentName,
          onSave: () => {},
          onToneChange: drafts.setAgentTone,
          selectedPresetLabel,
          tone: drafts.agentTone,
        }}
      />
    );
  }
  if (step === "preset") {
    return (
      <AgentSetupWizard
        busy={submitBusy}
        mode="first_run"
        step="preset"
        provider={{
          canSave: false,
          configuredProviders: [],
          filteredProviders: [],
          onProviderFilterChange: () => {},
          onProviderSave: () => {},
          onProviderSelectionChange: () => {},
          onProviderStateChange: () => {},
          providerFilter: "",
          providerFormError: null,
          providerState: drafts.providerState,
          selectedMethod: drafts.selectedMethod,
          selectedProvider: drafts.selectedProvider,
        }}
        preset={{
          canApplySelectedPreset: true,
          canReturnToProvider: false,
          canSave: Boolean(mutationHttp),
          filteredAvailableModels: drafts.filteredAvailableModels,
          modelFilter: drafts.modelFilter,
          modelState: drafts.modelState,
          onApplySelectedPreset: onPresetApply,
          onModelFilterChange: drafts.setModelFilter,
          onModelSave: onPresetSave,
          onModelSelectionChange: onSelectModel,
          onModelStateChange: drafts.setModelState,
          onSelectedPresetKeyChange: drafts.setSelectedPresetKey,
          presets: data.presets,
          selectedPresetKey: drafts.selectedPresetKey,
        }}
        agent={{
          canSave: false,
          name: drafts.agentName,
          onNameChange: drafts.setAgentName,
          onSave: () => {},
          onToneChange: drafts.setAgentTone,
          selectedPresetLabel,
          tone: drafts.agentTone,
        }}
      />
    );
  }
  if (step === "workspace_policy") {
    return (
      <OnboardingWorkspacePolicyStep
        busy={submitBusy}
        canSave={Boolean(mutationHttp?.policyConfig)}
        onSelectionChange={drafts.setWorkspacePolicyPreset}
        onSave={onWorkspacePolicySave}
        selectedPreset={drafts.workspacePolicyPreset}
      />
    );
  }
  return (
    <AgentSetupWizard
      busy={submitBusy}
      mode="first_run"
      step="agent"
      provider={{
        canSave: false,
        configuredProviders: [],
        filteredProviders: [],
        onProviderFilterChange: () => {},
        onProviderSave: () => {},
        onProviderSelectionChange: () => {},
        onProviderStateChange: () => {},
        providerFilter: "",
        providerFormError: null,
        providerState: drafts.providerState,
        selectedMethod: drafts.selectedMethod,
        selectedProvider: drafts.selectedProvider,
      }}
      preset={{
        canApplySelectedPreset: false,
        canReturnToProvider: false,
        canSave: false,
        filteredAvailableModels: drafts.filteredAvailableModels,
        modelFilter: drafts.modelFilter,
        modelState: drafts.modelState,
        onApplySelectedPreset: () => {},
        onModelFilterChange: drafts.setModelFilter,
        onModelSave: () => {},
        onModelSelectionChange: onSelectModel,
        onModelStateChange: drafts.setModelState,
        onSelectedPresetKeyChange: drafts.setSelectedPresetKey,
        presets: data.presets,
        selectedPresetKey: drafts.selectedPresetKey,
      }}
      agent={{
        canSave: Boolean(mutationHttp && selectedPreset && data.primaryAgentKey),
        name: drafts.agentName,
        onNameChange: drafts.setAgentName,
        onRandomizeName: onRandomizeAgentName,
        onSave: onAgentSave,
        onToneChange: drafts.setAgentTone,
        selectedPresetLabel,
        tone: drafts.agentTone,
      }}
    />
  );
}
