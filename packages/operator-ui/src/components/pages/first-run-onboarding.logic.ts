import {
  DEFAULT_PERSONA_TONE_INSTRUCTIONS,
  resolvePersonaToneInstructions,
} from "@tyrum/contracts";
import type { AgentConfig as AgentConfigT } from "@tyrum/contracts";
import type { OperatorCore } from "@tyrum/operator-app";
import * as React from "react";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { useAdminHttpClient } from "./admin-http-shared.js";
import {
  buildOnboardingIssueSignature,
  getRelevantOnboardingIssues,
  readOnboardingStoredState,
  supportsFirstRunOnboarding,
  writeOnboardingStoredState,
  type FirstRunOnboardingRenderableStepId,
  type FirstRunOnboardingStepId,
} from "./first-run-onboarding.shared.js";
import {
  EXECUTION_PROFILE_IDS,
  emptyDialogState,
  filterAvailableModels,
  normalizeDialogState,
  reconcileModelDialogState,
  splitModelRef,
  type AvailableModel,
  type ModelDialogState,
  type ModelPreset,
} from "./admin-http-models.shared.js";
import {
  buildProviderPayload,
  emptyFormState,
  reconcileProviderFormState,
  validateProviderForm,
  type ConfiguredProviderGroup,
  type ProviderFormState,
  type ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";
import { pickRandomAgentName } from "./agent-setup-wizard.shared.js";
import { type WorkspacePolicyPresetKey } from "./workspace-policy-presets.js";

export type FirstRunOnboardingController = {
  available: boolean;
  isOpen: boolean;
  issueSignature: string;
  close: () => void;
  open: () => void;
  skip: () => void;
  markCompleted: () => void;
};

type AgentPersonaT = NonNullable<AgentConfigT["persona"]>;

export type OnboardingDataState = {
  availableModels: AvailableModel[];
  errorMessage: string | null;
  existingAgentNames: string[];
  existingAgentKeys: string[];
  loading: boolean;
  presets: ModelPreset[];
  primaryAgentConfig: AgentConfigT | null;
  primaryAgentKey: string | null;
  primaryAgentPersona: AgentPersonaT | null;
  providers: ConfiguredProviderGroup[];
  registry: ProviderRegistryEntry[];
};

const DEFAULT_PERSONA_TONE = DEFAULT_PERSONA_TONE_INSTRUCTIONS;

export const EMPTY_DATA_STATE: OnboardingDataState = {
  availableModels: [],
  errorMessage: null,
  existingAgentNames: [],
  existingAgentKeys: [],
  loading: true,
  presets: [],
  primaryAgentConfig: null,
  primaryAgentKey: null,
  primaryAgentPersona: null,
  providers: [],
  registry: [],
};

function normalizeOnboardingAgentTone(tone: string | null | undefined): string {
  const trimmed = tone?.trim() ?? "";
  if (trimmed.length === 0) {
    return DEFAULT_PERSONA_TONE;
  }
  return resolvePersonaToneInstructions(trimmed);
}

export function isConnectedForOnboarding(
  connection: ReturnType<OperatorCore["connectionStore"]["getSnapshot"]>,
): boolean {
  return (
    connection.status === "connected" ||
    (connection.status === "connecting" && connection.recovering)
  );
}

export function countActiveProviders(providers: readonly ConfiguredProviderGroup[]): number {
  return providers.reduce((count, provider) => {
    return (
      count +
      provider.accounts.filter((account: { status: string }) => account.status === "active").length
    );
  }, 0);
}

export function resolvePreferredPresetKey(
  presets: readonly ModelPreset[],
  current: string,
): string {
  if (current && presets.some((preset) => preset.preset_key === current)) {
    return current;
  }
  return presets[0]?.preset_key ?? "";
}

export function buildDefaultAssignments(presetKey: string): Record<string, string | null> {
  return Object.fromEntries(
    EXECUTION_PROFILE_IDS.map((profileId) => [profileId, presetKey || null]),
  );
}

export function getSelectedPresetLabel(preset: ModelPreset | null): string {
  return preset
    ? `${preset.display_name} (${preset.provider_key}/${preset.model_id})`
    : "None selected";
}

export function getOnboardingProviderFormError(
  providerState: ProviderFormState,
  selectedMethod: ProviderRegistryEntry["methods"][number] | undefined,
): string | null {
  return validateProviderForm(providerState, selectedMethod, "create");
}

export function useFirstRunOnboardingController(input: {
  core: OperatorCore;
  hostKind: "desktop" | "mobile" | "web";
  scopeKey: string;
}): FirstRunOnboardingController {
  const connection = useOperatorStore(input.core.connectionStore);
  const status = useOperatorStore(input.core.statusStore);
  const [isOpen, setIsOpen] = React.useState(false);
  const issues = getRelevantOnboardingIssues(status.status?.config_health.issues ?? []);
  const issueSignature = React.useMemo(() => buildOnboardingIssueSignature(issues), [issues]);
  const lastNonEmptySignatureRef = React.useRef("");
  const supported = supportsFirstRunOnboarding(input.hostKind);
  const available =
    supported &&
    status.status !== null &&
    issues.length > 0 &&
    isConnectedForOnboarding(connection);

  React.useEffect(() => {
    if (issueSignature.length > 0) {
      lastNonEmptySignatureRef.current = issueSignature;
    }
  }, [issueSignature]);

  React.useEffect(() => {
    if (!supported) return;
    if (!isConnectedForOnboarding(connection)) return;
    if (status.status === null && status.loading.status) return;
    if (issues.length === 0) {
      return;
    }
    if (issueSignature.length === 0) return;

    const storedState = readOnboardingStoredState(input.scopeKey);
    if (storedState?.status === "skipped") {
      return;
    }
    setIsOpen(true);
  }, [
    connection,
    input.scopeKey,
    issueSignature,
    issues.length,
    status.loading.status,
    status.status,
    supported,
  ]);

  return React.useMemo(
    () => ({
      available,
      isOpen,
      issueSignature,
      close() {
        setIsOpen(false);
      },
      open() {
        setIsOpen(true);
      },
      skip() {
        const persistedSignature = issueSignature || lastNonEmptySignatureRef.current;
        writeOnboardingStoredState(input.scopeKey, {
          ...(persistedSignature.length > 0 ? { issueSignature: persistedSignature } : {}),
          status: "skipped",
        });
        setIsOpen(false);
      },
      markCompleted() {
        writeOnboardingStoredState(input.scopeKey, {
          ...(issueSignature.length > 0 ? { issueSignature } : {}),
          status: "completed",
        });
      },
    }),
    [available, input.scopeKey, isOpen, issueSignature],
  );
}

export function useOnboardingData(): {
  data: OnboardingDataState;
  refresh: () => Promise<void>;
} {
  const readHttp = useAdminHttpClient();
  const [data, setData] = React.useState<OnboardingDataState>(EMPTY_DATA_STATE);

  const refresh = React.useCallback(async (): Promise<void> => {
    setData((current) => ({ ...current, loading: true, errorMessage: null }));
    const [registryResult, providersResult, presetsResult, availableModelsResult, agentsResult] =
      await Promise.allSettled([
        readHttp.providerConfig.listRegistry(),
        readHttp.providerConfig.listProviders(),
        readHttp.modelConfig.listPresets(),
        readHttp.modelConfig.listAvailable(),
        readHttp.agents.list(),
      ]);

    const rejected = [
      registryResult,
      providersResult,
      presetsResult,
      availableModelsResult,
      agentsResult,
    ].find((result) => result.status === "rejected");

    const primaryAgent =
      agentsResult.status === "fulfilled"
        ? (agentsResult.value.agents.find((agent: { is_primary?: boolean }) => agent.is_primary) ??
          agentsResult.value.agents[0] ??
          null)
        : null;
    const primaryAgentKey = primaryAgent?.agent_key ?? null;
    const primaryAgentConfigResult =
      primaryAgentKey === null
        ? null
        : await Promise.allSettled([readHttp.agentConfig.get(primaryAgentKey)]);
    const primaryAgentConfigResponse =
      primaryAgentConfigResult?.[0]?.status === "fulfilled"
        ? primaryAgentConfigResult[0].value
        : null;
    const primaryAgentConfig = primaryAgentConfigResponse?.config ?? null;
    const primaryAgentPersona =
      primaryAgentConfigResponse?.persona ?? primaryAgent?.persona ?? null;

    setData({
      availableModels:
        availableModelsResult.status === "fulfilled" ? availableModelsResult.value.models : [],
      errorMessage: rejected?.status === "rejected" ? formatErrorMessage(rejected.reason) : null,
      existingAgentNames:
        agentsResult.status === "fulfilled"
          ? agentsResult.value.agents.flatMap((agent: { persona?: { name?: string | null } }) => {
              const name = agent.persona?.name?.trim();
              return name ? [name] : [];
            })
          : [],
      existingAgentKeys:
        agentsResult.status === "fulfilled"
          ? agentsResult.value.agents.map((agent: { agent_key: string }) => agent.agent_key)
          : [],
      loading: false,
      presets: presetsResult.status === "fulfilled" ? presetsResult.value.presets : [],
      primaryAgentConfig,
      primaryAgentKey,
      primaryAgentPersona,
      providers: providersResult.status === "fulfilled" ? providersResult.value.providers : [],
      registry: registryResult.status === "fulfilled" ? registryResult.value.providers : [],
    });
  }, [readHttp]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, refresh };
}

export function useOnboardingDrafts(data: OnboardingDataState) {
  const [providerState, setProviderState] = React.useState<ProviderFormState>(emptyFormState());
  const [providerFilter, setProviderFilter] = React.useState("");
  const [modelState, setModelState] = React.useState<ModelDialogState>(emptyDialogState());
  const [modelFilter, setModelFilter] = React.useState("");
  const [selectedPresetKey, setSelectedPresetKey] = React.useState("");
  const [agentName, setAgentName] = React.useState("");
  const [agentTone, setAgentTone] = React.useState("");
  const [workspacePolicyPreset, setWorkspacePolicyPreset] =
    React.useState<WorkspacePolicyPresetKey>("moderate");

  const supportedProviders = React.useMemo(
    () => data.registry.filter((provider) => provider.supported && provider.methods.length > 0),
    [data.registry],
  );
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
    selectedProvider?.methods.find(
      (method: ProviderRegistryEntry["methods"][number]) =>
        method.method_key === providerState.methodKey,
    ) ?? selectedProvider?.methods[0];

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
    setProviderFilter("");
  }, [data.registry]);

  React.useEffect(() => {
    setModelFilter("");
  }, [data.availableModels]);

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

  React.useEffect(() => {
    setSelectedPresetKey((current) => resolvePreferredPresetKey(data.presets, current));
  }, [data.presets]);

  React.useEffect(() => {
    if (data.loading) {
      return;
    }
    const persona = data.primaryAgentPersona;
    setAgentName((current) =>
      current.trim().length > 0
        ? current
        : pickRandomAgentName({
            currentName: persona?.name ?? "",
            existingAgentNames: data.existingAgentNames,
          }),
    );
    setAgentTone((current) => {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
      return normalizeOnboardingAgentTone(persona?.tone);
    });
  }, [data.existingAgentNames, data.loading, data.primaryAgentPersona]);

  return {
    agentName,
    agentTone,
    filteredAvailableModels,
    filteredProviders,
    modelFilter,
    modelState,
    providerFilter,
    providerState,
    selectedMethod,
    selectedPresetKey,
    selectedProvider,
    setAgentName,
    setAgentTone,
    setModelFilter,
    setModelState,
    setProviderFilter,
    setProviderState,
    setSelectedPresetKey,
    setWorkspacePolicyPreset,
    supportedProviders,
    workspacePolicyPreset,
  };
}

/**
 * Manages an optional step override that lets the user jump directly to another
 * onboarding step from the progress list. The override is automatically cleared
 * whenever the derived (system-state) step changes (forward progression).
 */
export function useOnboardingStepOverride(derivedStep: FirstRunOnboardingStepId): {
  step: FirstRunOnboardingStepId;
  overrideStep: FirstRunOnboardingRenderableStepId | null;
  clearOverride: () => void;
  goToStep: (stepId: FirstRunOnboardingRenderableStepId) => void;
} {
  const [overrideStep, setOverrideStep] = React.useState<FirstRunOnboardingRenderableStepId | null>(
    null,
  );
  const prevDerivedStepRef = React.useRef<FirstRunOnboardingStepId>(derivedStep);
  React.useEffect(() => {
    if (prevDerivedStepRef.current !== derivedStep) {
      prevDerivedStepRef.current = derivedStep;
      setOverrideStep(null);
    }
  }, [derivedStep]);

  const step: FirstRunOnboardingStepId = overrideStep ?? derivedStep;

  const clearOverride = React.useCallback(() => {
    setOverrideStep(null);
  }, []);

  const goToStep = React.useCallback(
    (stepId: FirstRunOnboardingRenderableStepId) => {
      if (stepId === derivedStep) {
        setOverrideStep(null);
        return;
      }
      setOverrideStep(stepId);
    },
    [derivedStep],
  );

  return { step, overrideStep, clearOverride, goToStep };
}

export function useOnboardingCompletionEffect(input: {
  derivedStep: FirstRunOnboardingStepId;
  overrideStep: FirstRunOnboardingRenderableStepId | null;
  submitBusy: boolean;
  onMarkCompleted: () => void;
}): void {
  const handledRef = React.useRef(false);
  React.useEffect(() => {
    if (input.derivedStep !== "done") {
      handledRef.current = false;
      return;
    }
    if (input.overrideStep) return;
    if (input.submitBusy) return;
    if (handledRef.current) return;
    handledRef.current = true;
    input.onMarkCompleted();
  }, [input.derivedStep, input.overrideStep, input.submitBusy, input.onMarkCompleted]);
}

export async function createPresetFromState(input: {
  createPreset: (payload: {
    display_name: string;
    provider_key: string;
    model_id: string;
    options: Record<string, string>;
  }) => Promise<{ preset: ModelPreset }>;
  modelState: ModelDialogState;
}): Promise<string> {
  const parsedModel = splitModelRef(input.modelState.modelRef);
  if (!parsedModel) {
    throw new Error("Choose a valid model.");
  }
  const result = await input.createPreset({
    display_name: input.modelState.displayName.trim(),
    provider_key: parsedModel.providerKey,
    model_id: parsedModel.modelId,
    options: {
      ...(input.modelState.reasoningEffort
        ? { reasoning_effort: input.modelState.reasoningEffort }
        : {}),
      ...(input.modelState.reasoningVisibility
        ? { reasoning_visibility: input.modelState.reasoningVisibility }
        : {}),
    },
  });
  return result.preset.preset_key;
}

export async function saveProviderAccountFromState(input: {
  createAccount: (payload: {
    provider_key: string;
    method_key: string;
    display_name: string;
    config: Record<string, unknown>;
    secrets: Record<string, string>;
  }) => Promise<unknown>;
  providerKey: string;
  providerState: ProviderFormState;
  selectedMethodKey: string;
  selectedMethod: ProviderRegistryEntry["methods"][number];
}): Promise<void> {
  await input.createAccount({
    provider_key: input.providerKey,
    method_key: input.selectedMethodKey,
    ...buildProviderPayload(input.providerState, input.selectedMethod),
  });
}
