import type { AdminHttpClient } from "./admin-http-shared.js";

export const EXECUTION_PROFILE_LABELS: Record<string, string> = {
  interaction: "Interaction",
  explorer_ro: "Explorer",
  reviewer_ro: "Reviewer",
  planner: "Planner",
  jury: "Jury",
  executor_rw: "Executor",
  integrator: "Integrator",
};

export type ProviderRegistryEntry = Awaited<
  ReturnType<AdminHttpClient["providerConfig"]["listRegistry"]>
>["providers"][number];
export type ProviderMethod = ProviderRegistryEntry["methods"][number];
export type ConfiguredProviderGroup = Awaited<
  ReturnType<AdminHttpClient["providerConfig"]["listProviders"]>
>["providers"][number];
export type ConfiguredProviderAccount = ConfiguredProviderGroup["accounts"][number];
export type ModelPreset = Awaited<
  ReturnType<AdminHttpClient["modelConfig"]["listPresets"]>
>["presets"][number];

export type ProviderFormState = {
  providerKey: string;
  methodKey: string;
  displayName: string;
  configValues: Record<string, string | boolean>;
  secretValues: Record<string, string>;
};

export type ProviderDeleteDialogState = {
  group: ConfiguredProviderGroup;
  requiredExecutionProfileIds: string[];
  replacementAssignments: Record<string, string | null>;
  candidatePresets: ModelPreset[];
} | null;

export function emptyFormState(): ProviderFormState {
  return {
    providerKey: "",
    methodKey: "",
    displayName: "",
    configValues: {},
    secretValues: {},
  };
}

export function getFieldStringValue(value: string | boolean | undefined): string {
  return typeof value === "string" ? value : "";
}

export function getFieldBooleanValue(value: string | boolean | undefined): boolean {
  return value === true;
}

export function getProviderStatusVariant(
  status: ConfiguredProviderAccount["status"],
): "success" | "warning" {
  return status === "active" ? "success" : "warning";
}

export function methodLabel(entry: ProviderRegistryEntry | undefined, methodKey: string): string {
  const method = entry?.methods.find((candidate) => candidate.method_key === methodKey);
  return method?.label ?? methodKey;
}

export function syncDisplayNameOnProviderChange(input: {
  currentDisplayName: string;
  currentProviderName?: string;
  nextProviderName?: string;
}): string {
  if (!input.currentDisplayName.trim()) {
    return input.nextProviderName ?? "";
  }
  if (input.currentDisplayName === (input.currentProviderName ?? "")) {
    return input.nextProviderName ?? "";
  }
  return input.currentDisplayName;
}

export function normalizeFormState(input: {
  registry: ProviderRegistryEntry[];
  providerKey?: string;
  account?: ConfiguredProviderAccount;
}): ProviderFormState {
  const supportedProviders = input.registry.filter(
    (provider) => provider.supported && provider.methods.length > 0,
  );
  const selectedProvider =
    supportedProviders.find((provider) => provider.provider_key === input.providerKey) ??
    supportedProviders[0];
  const selectedMethod =
    selectedProvider?.methods.find((method) => method.method_key === input.account?.method_key) ??
    selectedProvider?.methods[0];

  const configValues: Record<string, string | boolean> = {};
  const secretValues: Record<string, string> = {};
  if (selectedMethod && input.account) {
    for (const field of selectedMethod.fields) {
      if (field.kind !== "config") continue;
      const rawValue = input.account.config[field.key];
      if (field.input === "boolean") {
        configValues[field.key] = rawValue === true;
        continue;
      }
      if (typeof rawValue === "string") {
        configValues[field.key] = rawValue;
      }
    }
  } else if (selectedMethod) {
    for (const field of selectedMethod.fields) {
      if (field.kind === "config" && field.input === "boolean") {
        configValues[field.key] = false;
      }
    }
  }

  return {
    providerKey: selectedProvider?.provider_key ?? "",
    methodKey: selectedMethod?.method_key ?? "",
    displayName: input.account?.display_name ?? selectedProvider?.name ?? "",
    configValues,
    secretValues,
  };
}

export function validateProviderForm(
  state: ProviderFormState,
  method: ProviderMethod | undefined,
  mode: "create" | "edit",
): string | null {
  if (!state.providerKey) return "Provider is required.";
  if (!method) return "Authentication method is required.";
  if (!state.displayName.trim()) return "Display name is required.";

  for (const field of method.fields) {
    if (field.kind === "config") {
      if (field.input === "boolean") continue;
      const value = getFieldStringValue(state.configValues[field.key]).trim();
      if (field.required && !value) {
        return `${field.label} is required.`;
      }
      continue;
    }

    const value = getFieldStringValue(state.secretValues[field.key]).trim();
    if (mode === "create" && field.required && !value) {
      return `${field.label} is required.`;
    }
  }

  return null;
}

export function buildProviderPayload(
  state: ProviderFormState,
  method: ProviderMethod,
): {
  display_name: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
} {
  const config: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};

  for (const field of method.fields) {
    if (field.kind === "config") {
      if (field.input === "boolean") {
        config[field.key] = getFieldBooleanValue(state.configValues[field.key]);
        continue;
      }
      const value = getFieldStringValue(state.configValues[field.key]).trim();
      if (value) {
        config[field.key] = value;
      }
      continue;
    }

    const value = getFieldStringValue(state.secretValues[field.key]).trim();
    if (value) {
      secrets[field.key] = value;
    }
  }

  return {
    display_name: state.displayName.trim(),
    config,
    secrets,
  };
}
