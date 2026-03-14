import { AgentConfig, type AgentConfig as AgentConfigT } from "@tyrum/schemas";
import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { useAdminHttpClient } from "./admin-http-shared.js";
import {
  buildOnboardingIssueSignature,
  clearOnboardingStoredState,
  getRelevantOnboardingIssues,
  readOnboardingStoredState,
  supportsFirstRunOnboarding,
  writeOnboardingStoredState,
} from "./first-run-onboarding.shared.js";
import {
  EXECUTION_PROFILE_IDS,
  emptyDialogState,
  modelRefFor,
  normalizeAssignments,
  normalizeDialogState,
  splitModelRef,
  type Assignment,
  type AvailableModel,
  type ModelDialogState,
  type ModelPreset,
} from "./admin-http-models.shared.js";
import {
  buildProviderPayload,
  emptyFormState,
  normalizeFormState,
  type ConfiguredProviderGroup,
  type ProviderFormState,
  type ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";

export type FirstRunOnboardingController = {
  available: boolean;
  isOpen: boolean;
  issueSignature: string;
  close: () => void;
  open: () => void;
  dismiss: () => void;
  markCompleted: () => void;
};

export type OnboardingDataState = {
  assignments: Assignment[];
  availableModels: AvailableModel[];
  defaultAgentConfig: AgentConfigT | null;
  errorMessage: string | null;
  loading: boolean;
  presets: ModelPreset[];
  providers: ConfiguredProviderGroup[];
  registry: ProviderRegistryEntry[];
};

export const EMPTY_DATA_STATE: OnboardingDataState = {
  assignments: [],
  availableModels: [],
  defaultAgentConfig: null,
  errorMessage: null,
  loading: true,
  presets: [],
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
    return count + provider.accounts.filter((account) => account.status === "active").length;
  }, 0);
}

export function resolvePreferredPresetKey(
  presets: readonly ModelPreset[],
  assignments: readonly Assignment[],
  current: string,
): string {
  if (current && presets.some((preset) => preset.preset_key === current)) {
    return current;
  }
  const assignedPresetKey = assignments.find((assignment) => assignment.preset_key)?.preset_key;
  if (assignedPresetKey && presets.some((preset) => preset.preset_key === assignedPresetKey)) {
    return assignedPresetKey;
  }
  return presets[0]?.preset_key ?? "";
}

export function buildDefaultAssignments(presetKey: string): Record<string, string | null> {
  return Object.fromEntries(
    EXECUTION_PROFILE_IDS.map((profileId) => [profileId, presetKey || null]),
  );
}

export function buildDefaultAgentConfigUpdate(input: {
  currentConfig: AgentConfigT;
  nextModelRef: string;
}): AgentConfigT {
  const currentModel = input.currentConfig.model;
  const preserveCurrentSelection = currentModel.model === input.nextModelRef;

  return AgentConfig.parse({
    ...input.currentConfig,
    model: {
      model: input.nextModelRef,
      ...(preserveCurrentSelection && currentModel.variant
        ? { variant: currentModel.variant }
        : {}),
      ...(preserveCurrentSelection && currentModel.options
        ? { options: currentModel.options }
        : {}),
      ...(preserveCurrentSelection && currentModel.fallback?.length
        ? { fallback: currentModel.fallback }
        : {}),
    },
  });
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
      clearOnboardingStoredState(input.scopeKey);
      return;
    }
    if (issueSignature.length === 0) return;

    const storedState = readOnboardingStoredState(input.scopeKey);
    if (storedState && storedState.issueSignature === issueSignature) {
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
      dismiss() {
        const persistedSignature = issueSignature || lastNonEmptySignatureRef.current;
        if (persistedSignature.length > 0) {
          writeOnboardingStoredState(input.scopeKey, {
            issueSignature: persistedSignature,
            status: "dismissed",
          });
        }
        setIsOpen(false);
      },
      markCompleted() {
        if (issueSignature.length > 0) {
          writeOnboardingStoredState(input.scopeKey, {
            issueSignature,
            status: "completed",
          });
        }
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
    const [
      registryResult,
      providersResult,
      presetsResult,
      availableModelsResult,
      assignmentsResult,
      agentResult,
    ] = await Promise.allSettled([
      readHttp.providerConfig.listRegistry(),
      readHttp.providerConfig.listProviders(),
      readHttp.modelConfig.listPresets(),
      readHttp.modelConfig.listAvailable(),
      readHttp.modelConfig.listAssignments(),
      readHttp.agentConfig.get("default"),
    ]);

    const rejected = [
      registryResult,
      providersResult,
      presetsResult,
      availableModelsResult,
      assignmentsResult,
      agentResult,
    ].find((result) => result.status === "rejected");

    setData({
      assignments:
        assignmentsResult.status === "fulfilled"
          ? normalizeAssignments(assignmentsResult.value.assignments)
          : [],
      availableModels:
        availableModelsResult.status === "fulfilled" ? availableModelsResult.value.models : [],
      defaultAgentConfig: agentResult.status === "fulfilled" ? agentResult.value.config : null,
      errorMessage: rejected?.status === "rejected" ? formatErrorMessage(rejected.reason) : null,
      loading: false,
      presets: presetsResult.status === "fulfilled" ? presetsResult.value.presets : [],
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
  const [selectedPresetKey, setSelectedPresetKey] = React.useState("");
  const [assignmentDraft, setAssignmentDraft] = React.useState<Record<string, string | null>>({});
  const [assignmentTouched, setAssignmentTouched] = React.useState(false);

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
  const selectedProvider = supportedProviders.find(
    (provider) => provider.provider_key === providerState.providerKey,
  );
  const selectedMethod =
    selectedProvider?.methods.find((method) => method.method_key === providerState.methodKey) ??
    selectedProvider?.methods[0];

  React.useEffect(() => {
    setProviderState((current) => {
      if (
        current.providerKey &&
        supportedProviders.some((provider) => provider.provider_key === current.providerKey)
      ) {
        return current;
      }
      return normalizeFormState({ registry: data.registry });
    });
    setProviderFilter("");
  }, [data.registry, supportedProviders]);

  React.useEffect(() => {
    setModelState((current) => {
      if (
        current.modelRef &&
        data.availableModels.some((model) => modelRefFor(model) === current.modelRef)
      ) {
        return current;
      }
      return normalizeDialogState({ availableModels: data.availableModels });
    });
  }, [data.availableModels]);

  React.useEffect(() => {
    setSelectedPresetKey((current) =>
      resolvePreferredPresetKey(data.presets, data.assignments, current),
    );
  }, [data.assignments, data.presets]);

  React.useEffect(() => {
    if (assignmentTouched) return;
    if (!selectedPresetKey) {
      setAssignmentDraft(
        Object.fromEntries(
          data.assignments.map((assignment) => [
            assignment.execution_profile_id,
            assignment.preset_key,
          ]),
        ),
      );
      return;
    }
    setAssignmentDraft(buildDefaultAssignments(selectedPresetKey));
  }, [assignmentTouched, data.assignments, selectedPresetKey]);

  return {
    assignmentDraft,
    filteredProviders,
    modelState,
    providerFilter,
    providerState,
    selectedMethod,
    selectedPresetKey,
    selectedProvider,
    setAssignmentDraft,
    setAssignmentTouched,
    setModelState,
    setProviderFilter,
    setProviderState,
    setSelectedPresetKey,
    supportedProviders,
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
