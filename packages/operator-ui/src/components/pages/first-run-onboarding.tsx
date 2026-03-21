import type { OperatorCore } from "@tyrum/operator-app";
import * as React from "react";
import { useAdminAccessModeOptional } from "../../hooks/use-admin-access-mode.js";
import { useThemeOptional } from "../../hooks/use-theme.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Card, CardContent } from "../ui/card.js";
import { LoadingState } from "../ui/loading-state.js";
import { useElevatedModeUiContext } from "../elevated-mode/elevated-mode-provider.js";
import { useAdminMutationAccess, useAdminMutationHttpClient } from "./admin-http-shared.js";
import { selectProviderFormState } from "./admin-http-providers.shared.js";
import { selectModelDialogState } from "./admin-http-models.shared.js";
import { AgentSetupWizard } from "./agent-setup-wizard.js";
import { buildAgentConfigFromPreset, createUniqueAgentKey } from "./agent-setup-wizard.shared.js";
import {
  buildDefaultAssignments,
  countActiveProviders,
  createPresetFromState,
  getOnboardingProviderFormError,
  getSelectedPresetLabel,
  saveProviderAccountFromState,
  useOnboardingData,
  useOnboardingDrafts,
} from "./first-run-onboarding.logic.js";
import {
  buildOnboardingProgressItems,
  getRelevantOnboardingIssues,
  resolveVisibleFirstRunOnboardingStep,
} from "./first-run-onboarding.shared.js";
import { FirstRunOnboardingHeader } from "./first-run-onboarding.header.js";
import { OnboardingAdminStep, OnboardingPaletteStep } from "./first-run-onboarding.intro.js";
import { OnboardingProgressCard } from "./first-run-onboarding.parts.js";
import {
  OnboardingDoneStep,
  OnboardingWorkspacePolicyStep,
} from "./first-run-onboarding.sections.js";
import { saveWorkspacePolicyDeployment } from "./workspace-policy-presets.js";
export { useFirstRunOnboardingController } from "./first-run-onboarding.logic.js";
export function FirstRunOnboardingPage({
  core,
  onClose,
  onSkip,
  onMarkCompleted,
  onNavigate,
}: {
  core: OperatorCore;
  onClose: () => void;
  onSkip: () => void;
  onMarkCompleted: () => void;
  onNavigate: (routeId: "agents" | "configure" | "dashboard") => void;
}) {
  const { canMutate } = useAdminMutationAccess(core);
  const { enterElevatedMode } = useElevatedModeUiContext();
  const adminAccessModeSetting = useAdminAccessModeOptional();
  const adminAccessMode = adminAccessModeSetting?.mode ?? "on-demand";
  const mutationHttp = useAdminMutationHttpClient();
  const status = useOperatorStore(core.statusStore);
  const theme = useThemeOptional();
  const selectedPalette = theme?.palette ?? "copper";
  const issues = getRelevantOnboardingIssues(status.status?.config_health.issues ?? []);
  const [submitBusy, setSubmitBusy] = React.useState(false);
  const [submitErrorMessage, setSubmitErrorMessage] = React.useState<string | null>(null);
  const [paletteStepComplete, setPaletteStepComplete] = React.useState(false);
  const [adminStepComplete, setAdminStepComplete] = React.useState(false);
  const [selectedAdminAccessMode, setSelectedAdminAccessMode] = React.useState(adminAccessMode);
  const { data, refresh } = useOnboardingData();
  const drafts = useOnboardingDrafts(data);
  const activeProviderCount = countActiveProviders(data.providers);
  const selectedPreset =
    data.presets.find((preset) => preset.preset_key === drafts.selectedPresetKey) ?? null;
  const selectedPresetLabel = getSelectedPresetLabel(selectedPreset);
  const providerFormError = getOnboardingProviderFormError(
    drafts.providerState,
    drafts.selectedMethod,
  );

  React.useEffect(() => {
    setSelectedAdminAccessMode(adminAccessMode);
  }, [adminAccessMode]);

  React.useEffect(() => {
    if (issues.length === 0) {
      onMarkCompleted();
    }
  }, [issues.length, onMarkCompleted]);

  const step = React.useMemo(
    () =>
      resolveVisibleFirstRunOnboardingStep({
        issues,
        activeProviderCount,
        availableModelCount: data.availableModels.length,
        presetCount: data.presets.length,
        canMutate,
        paletteStepComplete,
        adminStepComplete,
      }),
    [
      activeProviderCount,
      adminStepComplete,
      canMutate,
      data.availableModels.length,
      data.presets.length,
      issues,
      paletteStepComplete,
    ],
  );
  const progressItems = React.useMemo(() => buildOnboardingProgressItems(step), [step]);

  const applyProviderSelection = React.useCallback(
    (providerKey: string) => {
      drafts.setProviderState((current) => {
        return selectProviderFormState({
          currentState: current,
          providerKey,
          supportedProviders: drafts.supportedProviders,
        });
      });
    },
    [drafts],
  );

  const applyModelSelection = React.useCallback(
    (modelRef: string) => {
      drafts.setModelState((current) =>
        selectModelDialogState({
          currentState: current,
          modelRef,
          availableModels: data.availableModels,
        }),
      );
    },
    [data.availableModels, drafts],
  );

  const runMutation = React.useCallback(
    async (action: () => Promise<void>): Promise<boolean> => {
      setSubmitBusy(true);
      setSubmitErrorMessage(null);
      try {
        await action();
        await core.syncAllNow();
        await refresh();
        return true;
      } catch (error) {
        setSubmitErrorMessage(formatErrorMessage(error));
        return false;
      } finally {
        setSubmitBusy(false);
      }
    },
    [core, refresh],
  );

  const applyPresetToDefaultProfiles = React.useCallback(
    async (presetKey: string) => {
      if (!mutationHttp) {
        throw new Error("Admin access is required to update model assignments.");
      }
      await mutationHttp.modelConfig.updateAssignments({
        assignments: buildDefaultAssignments(presetKey),
      });
    },
    [mutationHttp],
  );

  const renderStep = (): React.ReactElement => {
    if (data.loading) {
      return <LoadingState label="Loading onboarding state…" />;
    }
    if (step === "done") {
      return (
        <OnboardingDoneStep
          onClose={onClose}
          onMarkCompleted={onMarkCompleted}
          onNavigate={onNavigate}
        />
      );
    }
    if (step === "palette") {
      return (
        <OnboardingPaletteStep
          selectedPalette={selectedPalette}
          onSelectPalette={(palette) => {
            theme?.setPalette(palette);
          }}
          onContinue={() => {
            setPaletteStepComplete(true);
          }}
        />
      );
    }
    if (step === "admin") {
      return (
        <OnboardingAdminStep
          busy={submitBusy}
          canMutate={canMutate}
          selectedMode={selectedAdminAccessMode}
          onModeChange={setSelectedAdminAccessMode}
          continueWithAdminAccess={() => {
            void (async () => {
              const saved = await runMutation(async () => {
                adminAccessModeSetting?.setMode(selectedAdminAccessMode);
                if (!canMutate) {
                  await enterElevatedMode();
                }
              });
              if (saved) {
                setAdminStepComplete(true);
              }
            })();
          }}
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
            onProviderSave: () => {
              void runMutation(async () => {
                if (!mutationHttp || !drafts.selectedProvider || !drafts.selectedMethod) {
                  throw new Error("Choose a supported provider and authentication method.");
                }
                await saveProviderAccountFromState({
                  createAccount: mutationHttp.providerConfig.createAccount,
                  providerKey: drafts.selectedProvider.provider_key,
                  providerState: drafts.providerState,
                  selectedMethodKey: drafts.selectedMethod.method_key,
                  selectedMethod: drafts.selectedMethod,
                });
              });
            },
            onProviderSelectionChange: applyProviderSelection,
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
            onApplySelectedPreset: () => {
              void runMutation(async () => {
                if (!drafts.selectedPresetKey) {
                  throw new Error("Choose a saved preset first.");
                }
                await applyPresetToDefaultProfiles(drafts.selectedPresetKey);
              });
            },
            onModelFilterChange: drafts.setModelFilter,
            onModelSave: () => {
              void runMutation(async () => {
                if (!mutationHttp) {
                  throw new Error("Admin access is required to configure models.");
                }
                const presetKey = await createPresetFromState({
                  createPreset: mutationHttp.modelConfig.createPreset,
                  modelState: drafts.modelState,
                });
                drafts.setSelectedPresetKey(presetKey);
                await applyPresetToDefaultProfiles(presetKey);
              });
            },
            onModelSelectionChange: applyModelSelection,
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
          onSave={() => {
            void runMutation(async () => {
              await saveWorkspacePolicyDeployment({
                policyConfig: mutationHttp?.policyConfig,
                preset: drafts.workspacePolicyPreset,
              });
            });
          }}
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
          onModelSelectionChange: applyModelSelection,
          onModelStateChange: drafts.setModelState,
          onSelectedPresetKeyChange: drafts.setSelectedPresetKey,
          presets: data.presets,
          selectedPresetKey: drafts.selectedPresetKey,
        }}
        agent={{
          canSave: Boolean(mutationHttp && selectedPreset && data.primaryAgentKey),
          name: drafts.agentName,
          onNameChange: drafts.setAgentName,
          onSave: () => {
            void runMutation(async () => {
              if (
                !mutationHttp ||
                !selectedPreset ||
                !data.primaryAgentKey ||
                !mutationHttp.agents
              ) {
                throw new Error("Primary agent configuration is unavailable.");
              }
              const nextAgentKey = createUniqueAgentKey({
                agentName: drafts.agentName,
                existingAgentKeys: data.existingAgentKeys,
                currentAgentKey: data.primaryAgentKey,
              });
              if (nextAgentKey !== data.primaryAgentKey) {
                await mutationHttp.agents.rename(data.primaryAgentKey, {
                  agent_key: nextAgentKey,
                  reason: "onboarding: rename primary agent",
                });
              }
              const config = buildAgentConfigFromPreset({
                baseConfig: data.primaryAgentConfig,
                preset: selectedPreset,
                name: drafts.agentName,
                tone: drafts.agentTone,
              });
              await mutationHttp.agents.update(nextAgentKey, {
                config,
                reason: "onboarding: configure primary agent",
              });
            });
          },
          onToneChange: drafts.setAgentTone,
          selectedPresetLabel,
          tone: drafts.agentTone,
        }}
      />
    );
  };

  return (
    <AppPage
      bodyClassName="overflow-auto"
      contentClassName="max-w-5xl gap-6"
      contentLayout="fill"
      data-testid="first-run-onboarding"
    >
      <FirstRunOnboardingHeader
        step={step}
        onClose={onClose}
        onMarkCompleted={onMarkCompleted}
        onRefresh={() => {
          void refresh();
        }}
        onSkip={onSkip}
      />
      {data.errorMessage ? (
        <Alert
          variant="error"
          title="Unable to load onboarding data"
          description={data.errorMessage}
        />
      ) : null}
      {submitErrorMessage ? (
        <Alert
          variant="error"
          title="Unable to save onboarding step"
          description={submitErrorMessage}
        />
      ) : null}
      {step === "done" ? (
        <Card data-testid="first-run-onboarding-card">
          <CardContent className="grid gap-4 pt-6" data-testid="first-run-onboarding-card-body">
            {renderStep()}
          </CardContent>
        </Card>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[19rem_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]">
          <OnboardingProgressCard className="xl:self-start" items={progressItems} />
          <Card
            className="flex min-h-0 max-h-full flex-col self-start overflow-hidden"
            data-testid="first-run-onboarding-card"
          >
            <CardContent
              className="grid min-h-0 flex-1 gap-4 overflow-auto pt-6"
              data-testid="first-run-onboarding-card-body"
            >
              {renderStep()}
            </CardContent>
          </Card>
        </div>
      )}
    </AppPage>
  );
}
