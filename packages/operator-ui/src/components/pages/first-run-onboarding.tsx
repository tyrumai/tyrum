import type { OperatorCore } from "@tyrum/operator-app";
import * as React from "react";
import { useAdminAccessModeOptional } from "../../hooks/use-admin-access-mode.js";
import { useThemeOptional } from "../../hooks/use-theme.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Card, CardContent } from "../ui/card.js";
import { useElevatedModeUiContext } from "../elevated-mode/elevated-mode-provider.js";
import { useAdminMutationAccess, useAdminMutationHttpClient } from "./admin-http-shared.js";
import { selectProviderFormState } from "./admin-http-providers.shared.js";
import { selectModelDialogState } from "./admin-http-models.shared.js";
import { buildAgentConfigFromPreset, createUniqueAgentKey } from "./agent-setup-wizard.shared.js";
import {
  buildDefaultAssignments,
  countActiveProviders,
  createPresetFromState,
  getOnboardingProviderFormError,
  getSelectedPresetLabel,
  saveProviderAccountFromState,
  useOnboardingCompletionEffect,
  useOnboardingData,
  useOnboardingDrafts,
  useOnboardingStepOverride,
} from "./first-run-onboarding.logic.js";
import {
  buildOnboardingProgressItems,
  getRelevantOnboardingIssues,
  resolveVisibleFirstRunOnboardingStep,
} from "./first-run-onboarding.shared.js";
import { FirstRunOnboardingHeader } from "./first-run-onboarding.header.js";
import { OnboardingProgressCard } from "./first-run-onboarding.parts.js";
import { FirstRunOnboardingStepContent } from "./first-run-onboarding.step-content.js";
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

  const derivedStep = React.useMemo(
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

  const { step, overrideStep, clearOverride, goToStep } = useOnboardingStepOverride(derivedStep);
  useOnboardingCompletionEffect({ derivedStep, overrideStep, submitBusy, onMarkCompleted });

  const progressItems = React.useMemo(
    () => buildOnboardingProgressItems(derivedStep),
    [derivedStep],
  );

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

  const runMutationAndClear = React.useCallback(
    (action: () => Promise<void>) => {
      void runMutation(action).then((ok) => ok && clearOverride());
    },
    [clearOverride, runMutation],
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

  const handlePaletteContinue = React.useCallback(() => {
    setPaletteStepComplete(true);
    clearOverride();
  }, [clearOverride]);

  const handleAdminContinue = React.useCallback(() => {
    void (async () => {
      const saved = await runMutation(async () => {
        adminAccessModeSetting?.setMode(selectedAdminAccessMode);
        if (!canMutate) {
          await enterElevatedMode();
        }
      });
      if (saved) {
        setAdminStepComplete(true);
        clearOverride();
      }
    })();
  }, [
    adminAccessModeSetting,
    canMutate,
    clearOverride,
    enterElevatedMode,
    runMutation,
    selectedAdminAccessMode,
  ]);

  const handleProviderSave = React.useCallback(() => {
    runMutationAndClear(async () => {
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
  }, [
    drafts.providerState,
    drafts.selectedMethod,
    drafts.selectedProvider,
    mutationHttp,
    runMutationAndClear,
  ]);

  const handlePresetApply = React.useCallback(() => {
    runMutationAndClear(async () => {
      if (!drafts.selectedPresetKey) {
        throw new Error("Choose a saved preset first.");
      }
      await applyPresetToDefaultProfiles(drafts.selectedPresetKey);
    });
  }, [applyPresetToDefaultProfiles, drafts.selectedPresetKey, runMutationAndClear]);

  const handlePresetSave = React.useCallback(() => {
    runMutationAndClear(async () => {
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
  }, [
    applyPresetToDefaultProfiles,
    drafts.modelState,
    drafts.setSelectedPresetKey,
    mutationHttp,
    runMutationAndClear,
  ]);

  const handleWorkspacePolicySave = React.useCallback(() => {
    runMutationAndClear(async () => {
      await saveWorkspacePolicyDeployment({
        policyConfig: mutationHttp?.policyConfig,
        preset: drafts.workspacePolicyPreset,
      });
    });
  }, [drafts.workspacePolicyPreset, mutationHttp, runMutationAndClear]);

  const handleAgentSave = React.useCallback(() => {
    runMutationAndClear(async () => {
      if (!mutationHttp || !selectedPreset || !data.primaryAgentKey || !mutationHttp.agents) {
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
  }, [
    data.existingAgentKeys,
    data.primaryAgentConfig,
    data.primaryAgentKey,
    drafts.agentName,
    drafts.agentTone,
    mutationHttp,
    runMutationAndClear,
    selectedPreset,
  ]);

  const stepContent = (
    <FirstRunOnboardingStepContent
      canMutate={canMutate}
      data={data}
      drafts={drafts}
      mutationHttp={mutationHttp}
      onAdminContinue={handleAdminContinue}
      onAgentSave={handleAgentSave}
      onClose={onClose}
      onNavigate={onNavigate}
      onPaletteContinue={handlePaletteContinue}
      onPresetApply={handlePresetApply}
      onPresetSave={handlePresetSave}
      onProviderSave={handleProviderSave}
      onSelectModel={applyModelSelection}
      onSelectAdminAccessMode={setSelectedAdminAccessMode}
      onSelectMode={(mode) => {
        theme?.setMode(mode);
      }}
      onSelectPalette={(palette) => {
        theme?.setPalette(palette);
      }}
      onSelectProvider={applyProviderSelection}
      onWorkspacePolicySave={handleWorkspacePolicySave}
      providerFormError={providerFormError}
      selectedAdminAccessMode={selectedAdminAccessMode}
      selectedMode={theme?.mode ?? "dark"}
      selectedPalette={selectedPalette}
      selectedPreset={selectedPreset}
      selectedPresetLabel={selectedPresetLabel}
      step={step}
      submitBusy={submitBusy}
    />
  );

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
      {step === "done" && !overrideStep ? (
        <Card data-testid="first-run-onboarding-card">
          <CardContent className="grid gap-4 pt-6" data-testid="first-run-onboarding-card-body">
            {stepContent}
          </CardContent>
        </Card>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[19rem_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]">
          <OnboardingProgressCard
            className="xl:self-start"
            items={progressItems}
            activeStepId={step}
            onStepSelect={goToStep}
          />
          <Card
            className="flex min-h-0 max-h-full flex-col self-start overflow-hidden"
            data-testid="first-run-onboarding-card"
          >
            <CardContent
              className="grid min-h-0 flex-1 gap-4 overflow-auto pt-6"
              data-testid="first-run-onboarding-card-body"
            >
              {stepContent}
            </CardContent>
          </Card>
        </div>
      )}
    </AppPage>
  );
}
