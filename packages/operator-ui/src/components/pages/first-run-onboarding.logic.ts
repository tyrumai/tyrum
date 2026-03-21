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
  type ConfiguredProviderGroup,
  type ProviderFormState,
  type ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";
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

export type OnboardingDataState = {
  availableModels: AvailableModel[];
  errorMessage: string | null;
  existingAgentKeys: string[];
  loading: boolean;
  presets: ModelPreset[];
  primaryAgentConfig: AgentConfigT | null;
  primaryAgentKey: string | null;
  providers: ConfiguredProviderGroup[];
  registry: ProviderRegistryEntry[];
};

export const EMPTY_DATA_STATE: OnboardingDataState = {
  availableModels: [],
  errorMessage: null,
  existingAgentKeys: [],
  loading: true,
  presets: [],
  primaryAgentConfig: null,
  primaryAgentKey: null,
  providers: [],
  registry: [],
};

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

    const primaryAgentKey =
      agentsResult.status === "fulfilled"
        ? ((
            agentsResult.value.agents.find((agent: { is_primary?: boolean }) => agent.is_primary) ??
            agentsResult.value.agents[0]
          )?.agent_key ?? null)
        : null;
    const primaryAgentConfigResult =
      primaryAgentKey === null
        ? null
        : await Promise.allSettled([readHttp.agentConfig.get(primaryAgentKey)]);
    const primaryAgentConfig =
      primaryAgentConfigResult?.[0]?.status === "fulfilled"
        ? primaryAgentConfigResult[0].value.config
        : null;

    setData({
      availableModels:
        availableModelsResult.status === "fulfilled" ? availableModelsResult.value.models : [],
      errorMessage: rejected?.status === "rejected" ? formatErrorMessage(rejected.reason) : null,
      existingAgentKeys:
        agentsResult.status === "fulfilled"
          ? agentsResult.value.agents.map((agent: { agent_key: string }) => agent.agent_key)
          : [],
      loading: false,
      presets: presetsResult.status === "fulfilled" ? presetsResult.value.presets : [],
      primaryAgentConfig,
      primaryAgentKey,
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
    const persona = data.primaryAgentConfig?.persona;
    if (!persona) return;
    setAgentName((current) => (current.trim().length > 0 ? current : persona.name));
    setAgentTone((current) => (current.trim().length > 0 ? current : persona.tone));
  }, [data.primaryAgentConfig]);

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
