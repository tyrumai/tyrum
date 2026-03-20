import type { OperatorCore } from "@tyrum/operator-app";
import * as React from "react";
import { toast } from "sonner";
import { useApiAction } from "../../hooks/use-api-action.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Card, CardContent } from "../ui/card.js";
import { LoadingState } from "../ui/loading-state.js";
import { AgentSetupWizard } from "./agent-setup-wizard.js";
import {
  buildAgentConfigFromPreset,
  buildAgentPolicyBundle,
  createUniqueAgentKey,
  pickRandomAgentName,
  type AgentPolicyPresetKey,
} from "./agent-setup-wizard.shared.js";
import {
  emptyDialogState,
  filterAvailableModels,
  normalizeDialogState,
  reconcileModelDialogState,
  selectModelDialogState,
  type AvailableModel,
  type ModelDialogState,
  type ModelPreset,
} from "./admin-http-models.shared.js";
import {
  countActiveProviders,
  createPresetFromState,
  resolvePreferredPresetKey,
  saveProviderAccountFromState,
} from "./first-run-onboarding.logic.js";
import {
  emptyFormState,
  reconcileProviderFormState,
  selectProviderFormState,
  validateProviderForm,
  type ConfiguredProviderGroup,
  type ProviderFormState,
  type ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";

type CreateWizardStep = "provider" | "preset" | "agent";

type CreateWizardData = {
  availableModels: AvailableModel[];
  existingAgentKeys: string[];
  existingAgentNames: string[];
  presets: ModelPreset[];
  providers: ConfiguredProviderGroup[];
  registry: ProviderRegistryEntry[];
};

const EMPTY_WIZARD_DATA: CreateWizardData = {
  availableModels: [],
  existingAgentKeys: [],
  existingAgentNames: [],
  presets: [],
  providers: [],
  registry: [],
};

function supportsProviders(registry: readonly ProviderRegistryEntry[]): ProviderRegistryEntry[] {
  return registry.filter((provider) => provider.supported && provider.methods.length > 0);
}

function needsProviderStep(data: CreateWizardData): boolean {
  return (
    countActiveProviders(data.providers) === 0 ||
    (data.availableModels.length === 0 && data.presets.length === 0)
  );
}

function needsPresetStep(data: CreateWizardData): boolean {
  return data.presets.length === 0;
}

function resolveInitialStep(data: CreateWizardData): CreateWizardStep {
  if (needsProviderStep(data)) return "provider";
  if (needsPresetStep(data)) return "preset";
  return "agent";
}

export function AgentsPageCreateWizard({
  core,
  onCancel,
  onSaved,
}: {
  core: OperatorCore;
  onCancel: () => void;
  onSaved: (agentKey: string) => void;
}): React.ReactElement {
  const mutationHttp = core.admin;
  const [step, setStep] = React.useState<CreateWizardStep>("agent");
  const [data, setData] = React.useState<CreateWizardData>(EMPTY_WIZARD_DATA);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [providerState, setProviderState] = React.useState<ProviderFormState>(emptyFormState());
  const [providerFilter, setProviderFilter] = React.useState("");
  const [modelState, setModelState] = React.useState<ModelDialogState>(emptyDialogState());
  const [modelFilter, setModelFilter] = React.useState("");
  const [selectedPresetKey, setSelectedPresetKey] = React.useState("");
  const [agentName, setAgentName] = React.useState("");
  const [agentTone, setAgentTone] = React.useState("direct");
  const [policyPreset, setPolicyPreset] = React.useState<AgentPolicyPresetKey>("moderate");
  const saveAction = useApiAction<void>();

  const supportedProviders = React.useMemo(() => supportsProviders(data.registry), [data.registry]);
  const filteredProviders = React.useMemo(() => {
    const query = providerFilter.trim().toLowerCase();
    if (!query) return supportedProviders;
    return supportedProviders.filter((provider) => {
      return (
        provider.name.toLowerCase().includes(query) ||
        provider.provider_key.toLowerCase().includes(query)
      );
    });
  }, [providerFilter, supportedProviders]);
  const filteredAvailableModels = React.useMemo(
    () => filterAvailableModels(data.availableModels, modelFilter),
    [data.availableModels, modelFilter],
  );
  const selectedProvider = supportedProviders.find(
    (provider) => provider.provider_key === providerState.providerKey,
  );
  const selectedMethod =
    selectedProvider?.methods.find((method) => method.method_key === providerState.methodKey) ??
    selectedProvider?.methods[0];
  const providerFormError = validateProviderForm(providerState, selectedMethod, "create");
  const selectedPreset =
    data.presets.find((preset) => preset.preset_key === selectedPresetKey) ?? null;
  const showProviderStep = needsProviderStep(data);
  const showPresetStep = needsPresetStep(data);

  const refreshData = React.useCallback(
    async (preferredStep?: CreateWizardStep): Promise<void> => {
      setLoading(true);
      setLoadError(null);
      try {
        const [
          registryResult,
          providersResult,
          presetsResult,
          availableModelsResult,
          agentsResult,
        ] = await Promise.all([
          core.admin.providerConfig.listRegistry(),
          core.admin.providerConfig.listProviders(),
          core.admin.modelConfig.listPresets(),
          core.admin.modelConfig.listAvailable(),
          core.admin.agents.list(),
        ]);
        const nextData = {
          availableModels: availableModelsResult.models,
          existingAgentKeys: agentsResult.agents.map((agent) => agent.agent_key),
          existingAgentNames: agentsResult.agents.flatMap((agent) => {
            const name = agent.persona?.name?.trim();
            return name ? [name] : [];
          }),
          presets: presetsResult.presets,
          providers: providersResult.providers,
          registry: registryResult.providers,
        };
        setData(nextData);
        setStep(preferredStep ?? resolveInitialStep(nextData));
      } catch (error) {
        setLoadError(formatErrorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [core.admin],
  );

  React.useEffect(() => {
    void refreshData();
  }, [refreshData]);

  React.useEffect(() => {
    setProviderState((current) =>
      reconcileProviderFormState({
        currentState: current,
        filteredProviders,
        supportedProviders,
      }),
    );
  }, [filteredProviders, supportedProviders]);

  React.useEffect(() => {
    setSelectedPresetKey((current) => resolvePreferredPresetKey(data.presets, current));
  }, [data.presets]);

  React.useEffect(() => {
    setModelState((current) => {
      const nextState =
        current.modelRef || current.displayName.trim() || modelFilter.trim()
          ? current
          : normalizeDialogState({ availableModels: data.availableModels });

      return reconcileModelDialogState({
        currentState: nextState,
        filteredModels: filteredAvailableModels,
        availableModels: data.availableModels,
      });
    });
  }, [data.availableModels, filteredAvailableModels, modelFilter]);

  const applyProviderSelection = React.useCallback(
    (providerKey: string) => {
      setProviderState((current) =>
        selectProviderFormState({
          currentState: current,
          providerKey,
          supportedProviders,
        }),
      );
    },
    [supportedProviders],
  );

  const applyModelSelection = React.useCallback(
    (modelRef: string) => {
      setModelState((current) =>
        selectModelDialogState({
          currentState: current,
          modelRef,
          availableModels: data.availableModels,
        }),
      );
    },
    [data.availableModels],
  );

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    await saveAction.runAndThrow(action).catch((error) => {
      toast.error("Setup failed", { description: formatErrorMessage(error) });
      throw error;
    });
  };

  const saveProvider = async (): Promise<void> => {
    if (!selectedProvider || !selectedMethod) {
      throw new Error("Choose a supported provider and authentication method.");
    }
    await saveProviderAccountFromState({
      createAccount: mutationHttp.providerConfig.createAccount,
      providerKey: selectedProvider.provider_key,
      providerState,
      selectedMethodKey: selectedMethod.method_key,
      selectedMethod,
    });
    await refreshData();
  };

  const savePreset = async (): Promise<void> => {
    const presetKey = await createPresetFromState({
      createPreset: mutationHttp.modelConfig.createPreset,
      modelState,
    });
    setSelectedPresetKey(presetKey);
    await refreshData();
  };

  const createAgent = async (): Promise<void> => {
    if (!selectedPreset) {
      throw new Error("Choose a model preset before creating the agent.");
    }
    const agentKey = createUniqueAgentKey({
      agentName,
      existingAgentKeys: data.existingAgentKeys,
    });
    const config = buildAgentConfigFromPreset({
      preset: selectedPreset,
      name: agentName,
      tone: agentTone,
      policyPreset,
    });
    const created = await mutationHttp.agents.create({
      agent_key: agentKey,
      config,
      reason: "agents: create via setup wizard",
    });
    if (!mutationHttp.policyConfig) {
      toast.warning("Agent created with limited setup", {
        description: "The agent was created, but the policy preset was not applied.",
      });
      onSaved(created.agent_key);
      return;
    }
    try {
      await mutationHttp.policyConfig.updateAgent(created.agent_key, {
        bundle: buildAgentPolicyBundle(policyPreset),
        reason: "agents: apply setup wizard policy preset",
      });
    } catch (error) {
      toast.warning("Agent created with limited setup", {
        description: `${formatErrorMessage(error)}. The agent was created, but the policy preset was not applied.`,
      });
    }
    onSaved(created.agent_key);
  };

  const randomizeAgentName = React.useCallback(() => {
    setAgentName((current) =>
      pickRandomAgentName({
        currentName: current,
        existingAgentNames: data.existingAgentNames,
      }),
    );
  }, [data.existingAgentNames]);

  if (loading) {
    return (
      <Card data-testid="agents-create-wizard">
        <CardContent>
          <LoadingState variant="centered" label="Loading setup wizard…" />
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return <Alert variant="error" title="Agent setup unavailable" description={loadError} />;
  }

  return (
    <Card data-testid="agents-create-wizard">
      <CardContent className="grid gap-5 pt-6">
        <AgentSetupWizard
          busy={saveAction.isLoading}
          hasPresetStep={showPresetStep}
          hasProviderStep={showProviderStep}
          mode="create_agent"
          onCancel={onCancel}
          step={step}
          provider={{
            canSave: true,
            configuredProviders: data.providers,
            filteredProviders,
            onProviderFilterChange: setProviderFilter,
            onProviderSave: () => {
              void runAction(saveProvider);
            },
            onProviderSelectionChange: applyProviderSelection,
            onProviderStateChange: setProviderState,
            providerFilter,
            providerFormError,
            providerState,
            selectedMethod,
            selectedProvider,
          }}
          preset={{
            canApplySelectedPreset: true,
            canReturnToProvider: showProviderStep,
            canSave: true,
            filteredAvailableModels,
            modelFilter,
            modelState,
            onApplySelectedPreset: () => setStep("agent"),
            onBackToProvider: showProviderStep ? () => setStep("provider") : undefined,
            onModelFilterChange: setModelFilter,
            onModelSave: () => {
              void runAction(savePreset);
            },
            onModelSelectionChange: applyModelSelection,
            onModelStateChange: setModelState,
            onSelectedPresetKeyChange: setSelectedPresetKey,
            presets: data.presets,
            selectedPresetKey,
          }}
          agent={{
            canSave: Boolean(selectedPreset),
            name: agentName,
            nameRequired: true,
            onBackToPreset: showPresetStep ? () => setStep("preset") : undefined,
            onNameChange: setAgentName,
            onPolicyPresetChange: setPolicyPreset,
            onRandomizeName: randomizeAgentName,
            onSave: () => {
              void runAction(createAgent);
            },
            onToneChange: setAgentTone,
            policyPreset,
            selectedPresetLabel: "",
            showBackToPreset: showPresetStep,
            showPresetSummary: false,
            tone: agentTone,
          }}
        />
      </CardContent>
    </Card>
  );
}
