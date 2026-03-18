import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { LoadingState } from "../ui/loading-state.js";
import { useElevatedModeUiContext } from "../elevated-mode/elevated-mode-provider.js";
import { useAdminMutationAccess, useAdminMutationHttpClient } from "./admin-http-shared.js";
import { selectProviderFormState, validateProviderForm } from "./admin-http-providers.shared.js";
import { selectModelDialogState } from "./admin-http-models.shared.js";
import {
  buildDefaultAgentConfigUpdate,
  buildDefaultAssignments,
  countActiveProviders,
  createPresetFromState,
  saveProviderAccountFromState,
  useOnboardingData,
  useOnboardingDrafts,
} from "./first-run-onboarding.logic.js";
import {
  buildOnboardingProgressItems,
  getRelevantOnboardingIssues,
  resolveFirstRunOnboardingStep,
  type FirstRunOnboardingStepId,
} from "./first-run-onboarding.shared.js";
import { OnboardingProgressCard } from "./first-run-onboarding.parts.js";
import {
  OnboardingAdminStep,
  OnboardingAgentStep,
  OnboardingAssignmentsStep,
  OnboardingDoneStep,
  OnboardingPresetStep,
  OnboardingProviderStep,
} from "./first-run-onboarding.sections.js";

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
  const mutationHttp = useAdminMutationHttpClient();
  const status = useOperatorStore(core.statusStore);
  const issues = getRelevantOnboardingIssues(status.status?.config_health.issues ?? []);
  const [submitBusy, setSubmitBusy] = React.useState(false);
  const [submitErrorMessage, setSubmitErrorMessage] = React.useState<string | null>(null);
  const { data, refresh } = useOnboardingData();
  const drafts = useOnboardingDrafts(data);
  const activeProviderCount = React.useMemo(
    () => countActiveProviders(data.providers),
    [data.providers],
  );
  const selectedPreset =
    data.presets.find((preset) => preset.preset_key === drafts.selectedPresetKey) ?? null;
  const providerFormError = validateProviderForm(
    drafts.providerState,
    drafts.selectedMethod,
    "create",
  );

  React.useEffect(() => {
    if (issues.length === 0) {
      onMarkCompleted();
    }
  }, [issues.length, onMarkCompleted]);

  const step = React.useMemo<FirstRunOnboardingStepId>(() => {
    if (issues.length === 0) return "done";
    if (!canMutate) return "admin";
    return resolveFirstRunOnboardingStep({
      issues,
      activeProviderCount,
      availableModelCount: data.availableModels.length,
      presetCount: data.presets.length,
    });
  }, [activeProviderCount, canMutate, data.availableModels.length, data.presets.length, issues]);
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
    async (action: () => Promise<void>) => {
      setSubmitBusy(true);
      setSubmitErrorMessage(null);
      try {
        await action();
        await core.syncAllNow();
        await refresh();
        drafts.setAssignmentTouched(false);
      } catch (error) {
        setSubmitErrorMessage(formatErrorMessage(error));
      } finally {
        setSubmitBusy(false);
      }
    },
    [core, drafts, refresh],
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
    if (step === "admin") {
      return (
        <OnboardingAdminStep
          busy={submitBusy}
          enterAdminAccess={() => {
            void runMutation(async () => {
              await enterElevatedMode();
            });
          }}
        />
      );
    }
    if (step === "provider") {
      return (
        <OnboardingProviderStep
          busy={submitBusy}
          canSave={Boolean(mutationHttp)}
          configuredProviders={data.providers}
          filteredProviders={drafts.filteredProviders}
          onProviderFilterChange={drafts.setProviderFilter}
          onProviderSave={() => {
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
          }}
          onProviderSelectionChange={applyProviderSelection}
          onProviderStateChange={drafts.setProviderState}
          providerFilter={drafts.providerFilter}
          providerFormError={providerFormError}
          providerState={drafts.providerState}
          selectedProvider={drafts.selectedProvider}
          selectedRegistryProvider={drafts.selectedMethod}
        />
      );
    }
    if (step === "preset") {
      return (
        <OnboardingPresetStep
          busy={submitBusy}
          canSave={Boolean(mutationHttp)}
          filteredAvailableModels={drafts.filteredAvailableModels}
          modelFilter={drafts.modelFilter}
          modelState={drafts.modelState}
          onModelFilterChange={drafts.setModelFilter}
          onModelSave={() => {
            void runMutation(async () => {
              if (!mutationHttp) {
                throw new Error("Admin access is required to configure models.");
              }
              const presetKey = await createPresetFromState({
                createPreset: mutationHttp.modelConfig.createPreset,
                modelState: drafts.modelState,
              });
              drafts.setSelectedPresetKey(presetKey);
            });
          }}
          onModelSelectionChange={applyModelSelection}
          onModelStateChange={drafts.setModelState}
        />
      );
    }
    if (step === "assignments") {
      return (
        <OnboardingAssignmentsStep
          assignmentDraft={drafts.assignmentDraft}
          busy={submitBusy}
          canSave={Boolean(mutationHttp)}
          onApplyPresetToAll={() => {
            drafts.setAssignmentTouched(false);
            drafts.setAssignmentDraft(buildDefaultAssignments(drafts.selectedPresetKey));
          }}
          onAssignmentChange={(profileId, presetKey) => {
            drafts.setAssignmentTouched(true);
            drafts.setAssignmentDraft((current) => ({
              ...current,
              [profileId]: presetKey,
            }));
          }}
          onAssignmentSave={() => {
            void runMutation(async () => {
              if (!mutationHttp) {
                throw new Error("Admin access is required to update model assignments.");
              }
              await mutationHttp.modelConfig.updateAssignments({
                assignments: drafts.assignmentDraft,
              });
            });
          }}
          onPresetChange={(presetKey) => {
            drafts.setSelectedPresetKey(presetKey);
            drafts.setAssignmentTouched(false);
          }}
          presets={data.presets}
          selectedPresetKey={drafts.selectedPresetKey}
        />
      );
    }
    return (
      <OnboardingAgentStep
        busy={submitBusy}
        canSave={Boolean(mutationHttp && selectedPreset && data.defaultAgentConfig)}
        currentModel={data.defaultAgentConfig?.model.model ?? "None"}
        onAgentSave={() => {
          void runMutation(async () => {
            if (!mutationHttp || !selectedPreset || !data.defaultAgentConfig) {
              throw new Error("Default agent configuration is unavailable.");
            }
            await mutationHttp.agentConfig.update("default", {
              config: buildDefaultAgentConfigUpdate({
                currentConfig: data.defaultAgentConfig,
                nextModelRef: `${selectedPreset.provider_key}/${selectedPreset.model_id}`,
              }),
              reason: "onboarding: set default agent primary model",
            });
          });
        }}
        onPresetChange={drafts.setSelectedPresetKey}
        presets={data.presets}
        selectedPresetKey={drafts.selectedPresetKey}
      />
    );
  };

  return (
    <AppPage contentClassName="max-w-5xl gap-6" data-testid="first-run-onboarding">
      <section
        className="grid gap-4 rounded-2xl border border-border bg-bg-card px-5 py-5 shadow-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
        data-testid="first-run-onboarding-header"
      >
        <div className="grid gap-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-fg">Initial Setup</h2>
              </div>
              <div className="text-sm text-fg-muted">
                Finish the required setup before using the main operator workspace. You can skip now
                and resume later from the dashboard if needed.
              </div>
            </div>
          </div>
          <div className="text-xs text-fg-muted">
            Status is refreshed against the live gateway after each step.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void refresh();
            }}
          >
            Refresh
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (step === "done") {
                onMarkCompleted();
                onClose();
                return;
              }
              onSkip();
            }}
          >
            {step === "done" ? "Close" : "Skip setup"}
          </Button>
        </div>
      </section>
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
        <div className="grid items-start gap-4 xl:grid-cols-[19rem_minmax(0,1fr)]">
          <OnboardingProgressCard items={progressItems} />
          <Card
            className="flex min-h-0 flex-col overflow-hidden"
            data-testid="first-run-onboarding-card"
            style={{ maxHeight: "calc(100vh - 14rem - 4px)" }}
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
