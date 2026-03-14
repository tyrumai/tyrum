import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { useElevatedModeUiContext } from "../elevated-mode/elevated-mode-provider.js";
import { useAdminMutationAccess, useAdminMutationHttpClient } from "./admin-http-shared.js";
import {
  syncDisplayNameOnProviderChange,
  validateProviderForm,
} from "./admin-http-providers.shared.js";
import { modelRefFor } from "./admin-http-models.shared.js";
import {
  buildDefaultAgentConfigUpdate,
  buildDefaultAssignments,
  countActiveProviders,
  createPresetFromState,
  saveProviderAccountFromState,
  useOnboardingData,
  useOnboardingDrafts,
  useFirstRunOnboardingController,
} from "./first-run-onboarding.logic.js";
import {
  getRelevantOnboardingIssues,
  resolveFirstRunOnboardingStep,
  type FirstRunOnboardingStepId,
} from "./first-run-onboarding.shared.js";
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
  issueSignature,
  onClose,
  onDismiss,
  onMarkCompleted,
  onNavigate,
}: {
  core: OperatorCore;
  issueSignature: string;
  onClose: () => void;
  onDismiss: () => void;
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
  const availableModelChoices = data.availableModels.map((model) => ({
    modelRef: modelRefFor(model),
    label: `${model.provider_name} / ${model.model_name}`,
    modelName: model.model_name,
  }));

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

  const applyProviderSelection = React.useCallback(
    (providerKey: string) => {
      const nextProvider = drafts.supportedProviders.find(
        (provider) => provider.provider_key === providerKey,
      );
      drafts.setProviderState((current) => {
        const currentProviderName = drafts.supportedProviders.find(
          (provider) => provider.provider_key === current.providerKey,
        )?.name;
        const nextMethod = nextProvider?.methods[0];
        return {
          providerKey: nextProvider?.provider_key ?? "",
          methodKey: nextMethod?.method_key ?? "",
          displayName: syncDisplayNameOnProviderChange({
            currentDisplayName: current.displayName,
            currentProviderName,
            nextProviderName: nextProvider?.name,
          }),
          configValues: {},
          secretValues: {},
        };
      });
    },
    [drafts],
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
      return <div className="text-sm text-fg-muted">Loading onboarding state…</div>;
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
          availableModels={availableModelChoices}
          busy={submitBusy}
          canSave={Boolean(mutationHttp)}
          modelState={drafts.modelState}
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
    <AppPage contentClassName="max-w-4xl gap-5" data-testid="first-run-onboarding">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-fg">Initial Setup</h2>
              </div>
              <div className="text-sm text-fg-muted">
                Finish the first-run configuration so Tyrum can use its default runtime paths.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" data-testid="first-run-onboarding-issue-signature">
                {issueSignature || "no-issues"}
              </Badge>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  if (step === "done") {
                    onMarkCompleted();
                    onClose();
                    return;
                  }
                  onDismiss();
                }}
              >
                {step === "done" ? "Close" : "Dismiss"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
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
          {issues.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {issues.map((issue) => (
                <Badge
                  key={`${issue.code}:${issue.target.kind}:${issue.target.id ?? ""}`}
                  variant={issue.severity === "error" ? "danger" : "warning"}
                >
                  {issue.code}
                </Badge>
              ))}
            </div>
          ) : null}
          {renderStep()}
        </CardContent>
        <CardFooter className="justify-between">
          <div className="text-xs text-fg-muted">
            Status is refreshed against the live gateway after each step.
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void refresh();
            }}
          >
            Refresh
          </Button>
        </CardFooter>
      </Card>
    </AppPage>
  );
}
