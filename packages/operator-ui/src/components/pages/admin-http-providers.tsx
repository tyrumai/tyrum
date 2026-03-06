import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardFooter, CardHeader } from "../ui/card.js";
import { Checkbox } from "../ui/checkbox.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import {
  useAdminHttpClient,
  useAdminMutationAccess,
  type AdminHttpClient,
} from "./admin-http-shared.js";

const EXECUTION_PROFILE_LABELS: Record<string, string> = {
  interaction: "Interaction",
  explorer_ro: "Explorer",
  reviewer_ro: "Reviewer",
  planner: "Planner",
  jury: "Jury",
  executor_rw: "Executor",
  integrator: "Integrator",
};

type ProviderRegistryEntry = Awaited<
  ReturnType<AdminHttpClient["providerConfig"]["listRegistry"]>
>["providers"][number];
type ProviderMethod = ProviderRegistryEntry["methods"][number];
type ConfiguredProviderGroup = Awaited<
  ReturnType<AdminHttpClient["providerConfig"]["listProviders"]>
>["providers"][number];
type ConfiguredProviderAccount = ConfiguredProviderGroup["accounts"][number];
type ModelPreset = Awaited<
  ReturnType<AdminHttpClient["modelConfig"]["listPresets"]>
>["presets"][number];

type ProviderFormState = {
  providerKey: string;
  methodKey: string;
  displayName: string;
  configValues: Record<string, string | boolean>;
  secretValues: Record<string, string>;
};

type ProviderDeleteDialogState = {
  group: ConfiguredProviderGroup;
  requiredExecutionProfileIds: string[];
  replacementAssignments: Record<string, string>;
  candidatePresets: ModelPreset[];
} | null;

function emptyFormState(): ProviderFormState {
  return {
    providerKey: "",
    methodKey: "",
    displayName: "",
    configValues: {},
    secretValues: {},
  };
}

function getFieldStringValue(value: string | boolean | undefined): string {
  return typeof value === "string" ? value : "";
}

function getFieldBooleanValue(value: string | boolean | undefined): boolean {
  return value === true;
}

function getProviderStatusVariant(
  status: ConfiguredProviderAccount["status"],
): "success" | "warning" {
  return status === "active" ? "success" : "warning";
}

function methodLabel(entry: ProviderRegistryEntry | undefined, methodKey: string): string {
  const method = entry?.methods.find((candidate) => candidate.method_key === methodKey);
  return method?.label ?? methodKey;
}

function normalizeFormState(input: {
  registry: ProviderRegistryEntry[];
  configuredProviders: ConfiguredProviderGroup[];
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

function validateProviderForm(
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

function buildProviderPayload(
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

function ReplacementAssignmentsFields({
  requiredExecutionProfileIds,
  candidatePresets,
  selections,
  onChange,
}: {
  requiredExecutionProfileIds: string[];
  candidatePresets: ModelPreset[];
  selections: Record<string, string>;
  onChange: (profileId: string, presetKey: string) => void;
}): React.ReactElement | null {
  if (requiredExecutionProfileIds.length === 0) return null;

  return (
    <div className="grid gap-3">
      <Alert
        variant="warning"
        title="Model replacements required"
        description="This provider still owns models assigned to execution profiles. Choose replacement presets before removing it."
      />
      {requiredExecutionProfileIds.map((profileId) => (
        <Select
          key={profileId}
          label={`${EXECUTION_PROFILE_LABELS[profileId] ?? profileId} replacement`}
          value={selections[profileId] ?? ""}
          onChange={(event) => {
            onChange(profileId, event.currentTarget.value);
          }}
        >
          <option value="">Select a preset</option>
          {candidatePresets.map((preset) => (
            <option key={preset.preset_key} value={preset.preset_key}>
              {preset.display_name} ({preset.provider_key}/{preset.model_id})
            </option>
          ))}
        </Select>
      ))}
    </div>
  );
}

function ProviderAccountDialog({
  open,
  onOpenChange,
  registry,
  configuredProviders,
  initialProviderKey,
  account,
  onSaved,
  canMutate,
  core,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registry: ProviderRegistryEntry[];
  configuredProviders: ConfiguredProviderGroup[];
  initialProviderKey?: string | null;
  account: ConfiguredProviderAccount | null;
  onSaved: () => Promise<void>;
  canMutate: boolean;
  core: OperatorCore;
}): React.ReactElement {
  const api = (useAdminHttpClient() ?? core.http).providerConfig;
  const [state, setState] = React.useState<ProviderFormState>(emptyFormState());
  const [providerFilter, setProviderFilter] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const supportedProviders = React.useMemo(
    () => registry.filter((provider) => provider.supported && provider.methods.length > 0),
    [registry],
  );
  const configuredCounts = React.useMemo(
    () =>
      new Map(
        configuredProviders.map((provider) => [provider.provider_key, provider.accounts.length]),
      ),
    [configuredProviders],
  );
  const selectedProvider = supportedProviders.find(
    (provider) => provider.provider_key === state.providerKey,
  );
  const filteredSupportedProviders = React.useMemo(() => {
    const query = providerFilter.trim().toLowerCase();
    if (!query) return supportedProviders;
    const filtered = supportedProviders.filter((provider) => {
      const name = provider.name.toLowerCase();
      const key = provider.provider_key.toLowerCase();
      return name.includes(query) || key.includes(query);
    });
    if (
      selectedProvider &&
      !filtered.some((provider) => provider.provider_key === selectedProvider.provider_key)
    ) {
      return [selectedProvider, ...filtered];
    }
    return filtered;
  }, [providerFilter, selectedProvider, supportedProviders]);
  const selectedMethod =
    selectedProvider?.methods.find((method) => method.method_key === state.methodKey) ??
    selectedProvider?.methods[0];
  const mode = account ? "edit" : "create";

  React.useEffect(() => {
    if (!open) return;
    setProviderFilter("");
    setErrorMessage(null);
    setSaving(false);
    setState(
      normalizeFormState({
        registry,
        configuredProviders,
        providerKey: account?.provider_key ?? initialProviderKey ?? undefined,
        account: account ?? undefined,
      }),
    );
  }, [account, configuredProviders, initialProviderKey, open, registry]);

  const formError = validateProviderForm(state, selectedMethod, mode);

  const submit = async (): Promise<void> => {
    if (!canMutate) {
      throw new Error("Enter Elevated Mode to configure providers.");
    }
    if (!selectedProvider || !selectedMethod) {
      setErrorMessage("Choose a supported provider and authentication method.");
      return;
    }
    if (formError) {
      setErrorMessage(formError);
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    try {
      const payload = buildProviderPayload(state, selectedMethod);
      if (account) {
        await api.updateAccount(account.account_key, payload);
      } else {
        await api.createAccount({
          provider_key: selectedProvider.provider_key,
          method_key: selectedMethod.method_key,
          ...payload,
        });
      }
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="providers-account-dialog">
        <DialogHeader>
          <DialogTitle>{account ? "Edit provider account" : "Add provider"}</DialogTitle>
          <DialogDescription>
            {account
              ? "Update account details. Leave secret fields blank to keep the current value."
              : "Choose a provider and supply the credentials Tyrum needs to use it."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {!account ? (
            <Input
              label="Filter providers"
              value={providerFilter}
              helperText="Search by provider name or key."
              onChange={(event) => {
                setProviderFilter(event.currentTarget.value);
              }}
            />
          ) : null}

          <Select
            label="Provider"
            value={state.providerKey}
            disabled={Boolean(account)}
            onChange={(event) => {
              const nextProvider = supportedProviders.find(
                (provider) => provider.provider_key === event.currentTarget.value,
              );
              setState((current) => ({
                providerKey: nextProvider?.provider_key ?? "",
                methodKey: nextProvider?.methods[0]?.method_key ?? "",
                displayName: current.displayName.trim()
                  ? current.displayName
                  : (nextProvider?.name ?? ""),
                configValues: Object.fromEntries(
                  (nextProvider?.methods[0]?.fields ?? [])
                    .filter((field) => field.kind === "config" && field.input === "boolean")
                    .map((field) => [field.key, false]),
                ),
                secretValues: {},
              }));
            }}
            helperText={
              state.providerKey && configuredCounts.get(state.providerKey)
                ? "This provider is already configured. Saving will add another account."
                : undefined
            }
          >
            {filteredSupportedProviders.map((provider) => (
              <option key={provider.provider_key} value={provider.provider_key}>
                {provider.name}
              </option>
            ))}
          </Select>

          {selectedProvider ? (
            <Select
              label="Authentication method"
              value={state.methodKey}
              disabled={Boolean(account)}
              onChange={(event) => {
                const nextMethod = selectedProvider.methods.find(
                  (method) => method.method_key === event.currentTarget.value,
                );
                setState((current) => ({
                  ...current,
                  methodKey: nextMethod?.method_key ?? "",
                  configValues: Object.fromEntries(
                    (nextMethod?.fields ?? [])
                      .filter((field) => field.kind === "config" && field.input === "boolean")
                      .map((field) => [field.key, false]),
                  ),
                  secretValues: {},
                }));
              }}
            >
              {selectedProvider.methods.map((method) => (
                <option key={method.method_key} value={method.method_key}>
                  {method.label}
                </option>
              ))}
            </Select>
          ) : null}

          <Input
            label="Display name"
            required
            value={state.displayName}
            onChange={(event) => {
              setState((current) => ({
                ...current,
                displayName: event.currentTarget.value,
              }));
            }}
          />

          {selectedMethod?.fields.map((field) => {
            if (field.kind === "config" && field.input === "boolean") {
              return (
                <label
                  key={field.key}
                  className="flex items-start gap-3 rounded-lg border border-border/60 p-3"
                >
                  <Checkbox
                    checked={getFieldBooleanValue(state.configValues[field.key])}
                    onCheckedChange={(checked) => {
                      setState((current) => ({
                        ...current,
                        configValues: {
                          ...current.configValues,
                          [field.key]: Boolean(checked),
                        },
                      }));
                    }}
                  />
                  <span className="grid gap-1 text-sm">
                    <span className="font-medium text-fg">{field.label}</span>
                    {field.description ? (
                      <span className="text-fg-muted">{field.description}</span>
                    ) : null}
                  </span>
                </label>
              );
            }

            const isSecret = field.kind === "secret";
            return (
              <Input
                key={field.key}
                label={field.label}
                required={field.required && !(account && isSecret)}
                type={isSecret ? "password" : "text"}
                autoComplete="off"
                value={
                  isSecret
                    ? getFieldStringValue(state.secretValues[field.key])
                    : getFieldStringValue(state.configValues[field.key])
                }
                helperText={
                  account && isSecret
                    ? "Leave blank to keep the current value."
                    : (field.description ?? undefined)
                }
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  setState((current) => ({
                    ...current,
                    ...(isSecret
                      ? {
                          secretValues: {
                            ...current.secretValues,
                            [field.key]: nextValue,
                          },
                        }
                      : {
                          configValues: {
                            ...current.configValues,
                            [field.key]: nextValue,
                          },
                        }),
                  }));
                }}
              />
            );
          })}

          {!selectedProvider ? (
            <Alert
              variant="warning"
              title="No supported providers available"
              description="The model catalog does not currently expose any supported provider setup flows."
            />
          ) : null}

          {errorMessage ? (
            <Alert variant="error" title="Unable to save" description={errorMessage} />
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            data-testid="providers-save"
            isLoading={saving}
            disabled={!canMutate || !selectedProvider || !selectedMethod || formError !== null}
            onClick={() => {
              void submit();
            }}
          >
            {account ? "Save account" : "Add provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AdminHttpProvidersPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const mutationHttp = useAdminHttpClient() ?? core.http;
  const readHttp = core.http;
  const [registry, setRegistry] = React.useState<ProviderRegistryEntry[]>([]);
  const [providers, setProviders] = React.useState<ConfiguredProviderGroup[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogProviderKey, setDialogProviderKey] = React.useState<string | null>(null);
  const [editingAccount, setEditingAccount] = React.useState<ConfiguredProviderAccount | null>(
    null,
  );
  const [deletingAccount, setDeletingAccount] = React.useState<ConfiguredProviderAccount | null>(
    null,
  );
  const [deletingProvider, setDeletingProvider] = React.useState<ProviderDeleteDialogState>(null);
  const [actionKey, setActionKey] = React.useState<string | null>(null);

  const refresh = React.useCallback(async (): Promise<void> => {
    setRefreshing(true);
    setErrorMessage(null);
    try {
      const [registryResult, providerResult] = await Promise.all([
        readHttp.providerConfig.listRegistry(),
        readHttp.providerConfig.listProviders(),
      ]);
      setRegistry(registryResult.providers);
      setProviders(providerResult.providers);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [readHttp.providerConfig]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleAccountStatus = async (
    account: ConfiguredProviderAccount,
    status: ConfiguredProviderAccount["status"],
  ): Promise<void> => {
    if (!canMutate) {
      requestEnter();
      return;
    }
    setActionKey(`${account.account_key}:${status}`);
    setErrorMessage(null);
    try {
      await mutationHttp.providerConfig.updateAccount(account.account_key, { status });
      await refresh();
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setActionKey(null);
    }
  };

  const removeAccount = async (): Promise<void> => {
    if (!deletingAccount) return;
    await mutationHttp.providerConfig.deleteAccount(deletingAccount.account_key);
    setDeletingAccount(null);
    await refresh();
  };

  const removeProvider = async (): Promise<void> => {
    if (!deletingProvider) return;
    if (
      deletingProvider.requiredExecutionProfileIds.some(
        (profileId) => !deletingProvider.replacementAssignments[profileId],
      )
    ) {
      throw new Error("Select a replacement preset for every required execution profile.");
    }
    const replacementAssignments =
      deletingProvider.requiredExecutionProfileIds.length > 0
        ? deletingProvider.replacementAssignments
        : undefined;

    const result = await mutationHttp.providerConfig.deleteProvider(
      deletingProvider.group.provider_key,
      replacementAssignments ? { replacement_assignments: replacementAssignments } : undefined,
    );

    if ("error" in result) {
      const presets = await readHttp.modelConfig.listPresets();
      setDeletingProvider((current) =>
        current
          ? {
              ...current,
              requiredExecutionProfileIds: result.required_execution_profile_ids,
              candidatePresets: presets.presets.filter(
                (preset) => preset.provider_key !== current.group.provider_key,
              ),
            }
          : current,
      );
      throw new Error("Select replacement presets before removing this provider.");
    }

    setDeletingProvider(null);
    await refresh();
  };

  const unsupportedProviders = registry.filter((provider) => !provider.supported);

  return (
    <section className="grid gap-4" data-testid="admin-http-providers">
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <div className="text-sm font-medium text-fg">Providers</div>
              <div className="text-sm text-fg-muted">
                Configure accounts once, then choose from their models in the Models tab.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                data-testid="providers-refresh"
                isLoading={refreshing}
                onClick={() => {
                  void refresh();
                }}
              >
                Refresh
              </Button>
              <Button
                type="button"
                data-testid="providers-add-open"
                disabled={!canMutate || registry.every((provider) => !provider.supported)}
                onClick={() => {
                  if (!canMutate) {
                    requestEnter();
                    return;
                  }
                  setEditingAccount(null);
                  setDialogProviderKey(null);
                  setDialogOpen(true);
                }}
              >
                Add provider
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {errorMessage ? (
            <Alert variant="error" title="Provider config failed" description={errorMessage} />
          ) : null}

          {unsupportedProviders.length > 0 ? (
            <Alert
              variant="info"
              title="Some providers are not configurable yet"
              description={unsupportedProviders.map((provider) => provider.name).join(", ")}
            />
          ) : null}

          {loading ? (
            <div className="text-sm text-fg-muted">Loading providers…</div>
          ) : providers.length === 0 ? (
            <Alert
              variant="info"
              title="No providers configured"
              description="Add a provider account to make its models available."
            />
          ) : (
            providers.map((group) => (
              <Card key={group.provider_key} className="border-border/50 bg-bg/30">
                <CardHeader className="pb-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="grid gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-base font-semibold text-fg">{group.name}</div>
                        <Badge variant={group.supported ? "outline" : "warning"}>
                          {group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}
                        </Badge>
                      </div>
                      {group.doc ? (
                        <a
                          href={group.doc}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-primary underline-offset-4 hover:underline"
                        >
                          Provider documentation
                        </a>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!canMutate}
                        onClick={() => {
                          if (!canMutate) {
                            requestEnter();
                            return;
                          }
                          setEditingAccount(null);
                          setDialogProviderKey(group.provider_key);
                          setDialogOpen(true);
                        }}
                      >
                        Add account
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        disabled={!canMutate}
                        onClick={() => {
                          if (!canMutate) {
                            requestEnter();
                            return;
                          }
                          setDeletingProvider({
                            group,
                            requiredExecutionProfileIds: [],
                            replacementAssignments: {},
                            candidatePresets: [],
                          });
                        }}
                      >
                        Remove provider
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3 pt-0">
                  {group.accounts.map((account) => (
                    <div
                      key={account.account_key}
                      className="grid gap-3 rounded-xl border border-border/60 bg-bg-card/40 p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="grid gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-fg">{account.display_name}</div>
                            <Badge variant={getProviderStatusVariant(account.status)}>
                              {account.status}
                            </Badge>
                            <Badge variant="outline">
                              {methodLabel(
                                registry.find(
                                  (provider) => provider.provider_key === group.provider_key,
                                ),
                                account.method_key,
                              )}
                            </Badge>
                          </div>
                          <div className="text-sm text-fg-muted">
                            Secrets configured:{" "}
                            {account.configured_secret_keys.length > 0
                              ? account.configured_secret_keys.join(", ")
                              : "none"}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={!canMutate}
                            onClick={() => {
                              if (!canMutate) {
                                requestEnter();
                                return;
                              }
                              setDialogProviderKey(null);
                              setEditingAccount(account);
                              setDialogOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            isLoading={
                              actionKey ===
                              `${account.account_key}:${account.status === "active" ? "disabled" : "active"}`
                            }
                            disabled={!canMutate}
                            onClick={() => {
                              void toggleAccountStatus(
                                account,
                                account.status === "active" ? "disabled" : "active",
                              );
                            }}
                          >
                            {account.status === "active" ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            disabled={!canMutate}
                            onClick={() => {
                              if (!canMutate) {
                                requestEnter();
                                return;
                              }
                              setDeletingAccount(account);
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
        {!canMutate ? (
          <CardFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                requestEnter();
              }}
            >
              Enter Elevated Mode
            </Button>
          </CardFooter>
        ) : null}
      </Card>

      <ProviderAccountDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingAccount(null);
            setDialogProviderKey(null);
          }
        }}
        registry={registry}
        configuredProviders={providers}
        initialProviderKey={dialogProviderKey}
        account={editingAccount}
        onSaved={refresh}
        canMutate={canMutate}
        core={core}
      />

      <ConfirmDangerDialog
        open={deletingAccount !== null}
        onOpenChange={(open) => {
          if (open) return;
          setDeletingAccount(null);
        }}
        title="Remove provider account"
        description={
          deletingAccount
            ? `Remove ${deletingAccount.display_name}. Any pinned sessions will fall back to another account if one exists.`
            : undefined
        }
        confirmLabel="Remove account"
        onConfirm={removeAccount}
      />

      <ConfirmDangerDialog
        open={deletingProvider !== null}
        onOpenChange={(open) => {
          if (open) return;
          setDeletingProvider(null);
        }}
        title="Remove provider"
        description={
          deletingProvider
            ? `Remove ${deletingProvider.group.name} and every configured account under it.`
            : undefined
        }
        confirmLabel="Remove provider"
        onConfirm={removeProvider}
      >
        {deletingProvider ? (
          <ReplacementAssignmentsFields
            requiredExecutionProfileIds={deletingProvider.requiredExecutionProfileIds}
            candidatePresets={deletingProvider.candidatePresets}
            selections={deletingProvider.replacementAssignments}
            onChange={(profileId, presetKey) => {
              setDeletingProvider((current) =>
                current
                  ? {
                      ...current,
                      replacementAssignments: {
                        ...current.replacementAssignments,
                        [profileId]: presetKey,
                      },
                    }
                  : current,
              );
            }}
          />
        ) : null}
      </ConfirmDangerDialog>
    </section>
  );
}
