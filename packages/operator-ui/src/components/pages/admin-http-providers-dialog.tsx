import * as React from "react";
import { cn } from "../../lib/cn.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Checkbox } from "../ui/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { Select } from "../ui/select.js";
import type { AdminHttpClient } from "./admin-http-shared.js";
import {
  buildProviderPayload,
  emptyFormState,
  getFieldBooleanValue,
  getFieldStringValue,
  normalizeFormState,
  syncDisplayNameOnProviderChange,
  validateProviderForm,
  type ConfiguredProviderAccount,
  type ConfiguredProviderGroup,
  type ProviderMethod,
  type ProviderFormState,
  type ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";

const PROVIDER_PICKER_VISIBLE_COUNT = 5;
const PROVIDER_PICKER_ROW_REM = 4.25;

function getBooleanConfigDefaults(method: ProviderMethod | undefined): Record<string, boolean> {
  return Object.fromEntries(
    (method?.fields ?? [])
      .filter((field) => field.kind === "config" && field.input === "boolean")
      .map((field) => [field.key, false]),
  );
}

export function ProviderAccountDialog({
  open,
  onOpenChange,
  registry,
  configuredProviders,
  initialProviderKey,
  account,
  onSaved,
  canMutate,
  api,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  registry: ProviderRegistryEntry[];
  configuredProviders: ConfiguredProviderGroup[];
  initialProviderKey?: string | null;
  account: ConfiguredProviderAccount | null;
  onSaved: () => Promise<void>;
  canMutate: boolean;
  api: AdminHttpClient["providerConfig"];
}): React.ReactElement {
  const [state, setState] = React.useState<ProviderFormState>(emptyFormState());
  const [providerFilter, setProviderFilter] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [autoSelectReady, setAutoSelectReady] = React.useState(false);
  const providerFilterId = React.useId();

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
    return supportedProviders.filter((provider) => {
      const name = provider.name.toLowerCase();
      const key = provider.provider_key.toLowerCase();
      return name.includes(query) || key.includes(query);
    });
  }, [providerFilter, supportedProviders]);
  const selectedMethod =
    selectedProvider?.methods.find((method) => method.method_key === state.methodKey) ??
    selectedProvider?.methods[0];
  const mode = account ? "edit" : "create";
  const providerPickerHeightRem =
    Math.min(Math.max(filteredSupportedProviders.length, 1), PROVIDER_PICKER_VISIBLE_COUNT) *
    PROVIDER_PICKER_ROW_REM;
  const selectedProviderConfiguredCount = state.providerKey
    ? (configuredCounts.get(state.providerKey) ?? 0)
    : 0;

  React.useEffect(() => {
    if (!open) {
      setAutoSelectReady(false);
      return;
    }
    setAutoSelectReady(false);
    setProviderFilter("");
    setErrorMessage(null);
    setSaving(false);
    setState(
      normalizeFormState({
        registry,
        providerKey: account?.provider_key ?? initialProviderKey ?? undefined,
        account: account ?? undefined,
      }),
    );
  }, [account, initialProviderKey, open, registry]);

  React.useEffect(() => {
    if (!open) return;
    setAutoSelectReady(true);
  }, [account, initialProviderKey, open, registry]);

  const applyProviderSelection = React.useCallback(
    (providerKey: string) => {
      const nextProvider = supportedProviders.find(
        (provider) => provider.provider_key === providerKey,
      );
      setState((current) => {
        const currentProviderName = supportedProviders.find(
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
          configValues: getBooleanConfigDefaults(nextMethod),
          secretValues: {},
        };
      });
    },
    [supportedProviders],
  );

  React.useEffect(() => {
    if (!open || account || !autoSelectReady) return;
    if (
      filteredSupportedProviders.some((provider) => provider.provider_key === state.providerKey)
    ) {
      return;
    }
    const firstVisibleProvider = filteredSupportedProviders[0];
    if (firstVisibleProvider) {
      applyProviderSelection(firstVisibleProvider.provider_key);
      return;
    }
    setState((current) =>
      current.providerKey || current.methodKey || Object.keys(current.secretValues).length > 0
        ? (() => {
            const currentProviderName = supportedProviders.find(
              (provider) => provider.provider_key === current.providerKey,
            )?.name;
            const shouldClearDisplayName =
              !current.displayName.trim() || current.displayName === (currentProviderName ?? "");
            return {
              ...current,
              providerKey: "",
              methodKey: "",
              displayName: shouldClearDisplayName ? "" : current.displayName,
              configValues: {},
              secretValues: {},
            };
          })()
        : current,
    );
  }, [
    account,
    applyProviderSelection,
    autoSelectReady,
    filteredSupportedProviders,
    open,
    state.providerKey,
    supportedProviders,
  ]);

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
            <div className="grid gap-1.5">
              <Label htmlFor={providerFilterId} required>
                Provider
              </Label>
              <div className="overflow-hidden rounded-lg border border-border bg-bg-card/40">
                <div className="border-b border-border/70 p-2">
                  <input
                    id={providerFilterId}
                    type="text"
                    value={providerFilter}
                    data-testid="providers-filter-input"
                    aria-label="Filter providers"
                    placeholder="Filter providers by name or key"
                    onChange={(event) => {
                      setProviderFilter(event.currentTarget.value);
                    }}
                    className={cn(
                      "box-border flex h-8 w-full rounded-md border border-border bg-bg px-2.5 py-1 text-sm text-fg transition-[border-color,box-shadow] duration-150",
                      "placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
                    )}
                  />
                </div>
                <ScrollArea
                  className="w-full"
                  data-testid="providers-provider-picker"
                  style={{ height: `${providerPickerHeightRem}rem` }}
                >
                  <div className="grid gap-1 p-2" role="radiogroup" aria-label="Provider">
                    {filteredSupportedProviders.length > 0 ? (
                      filteredSupportedProviders.map((provider) => {
                        const active = provider.provider_key === state.providerKey;
                        const configuredCount = configuredCounts.get(provider.provider_key) ?? 0;
                        const accountLabel =
                          configuredCount === 1
                            ? "1 account configured"
                            : `${configuredCount} accounts configured`;

                        return (
                          <button
                            key={provider.provider_key}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            data-testid={`providers-provider-option-${provider.provider_key}`}
                            className={cn(
                              "flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
                              active
                                ? "border-primary bg-bg text-fg"
                                : "border-border bg-bg hover:bg-bg-subtle",
                            )}
                            onClick={() => {
                              applyProviderSelection(provider.provider_key);
                            }}
                          >
                            <div className="grid gap-0.5">
                              <span className="text-sm font-medium text-fg">{provider.name}</span>
                              <span className="text-xs text-fg-muted">{provider.provider_key}</span>
                            </div>
                            <div className="grid justify-items-end gap-1 text-xs text-fg-muted">
                              {configuredCount > 0 ? (
                                <span
                                  className={cn(
                                    "rounded-full border px-2 py-0.5",
                                    active
                                      ? "border-primary/50 bg-primary/10 text-fg"
                                      : "border-border bg-bg-card/60",
                                  )}
                                >
                                  {accountLabel}
                                </span>
                              ) : (
                                <span>Not configured</span>
                              )}
                              {provider.methods.length > 1 ? (
                                <span>{provider.methods.length} auth methods</span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-fg-muted">
                        No providers match this filter.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
              <p className="text-sm text-fg-muted">
                Type to narrow the list. Up to five providers stay visible before scrolling.
              </p>
              {selectedProviderConfiguredCount > 0 ? (
                <p className="text-sm text-fg-muted">
                  This provider is already configured. Saving will add another account.
                </p>
              ) : null}
            </div>
          ) : null}

          {account ? (
            <Select
              label="Provider"
              value={state.providerKey}
              disabled={true}
              helperText={
                state.providerKey && configuredCounts.get(state.providerKey)
                  ? "This provider is already configured. Saving will add another account."
                  : undefined
              }
            >
              {supportedProviders.map((provider) => (
                <option key={provider.provider_key} value={provider.provider_key}>
                  {provider.name}
                </option>
              ))}
            </Select>
          ) : null}

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
                  configValues: getBooleanConfigDefaults(nextMethod),
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
