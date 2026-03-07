import * as React from "react";
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
  type ProviderFormState,
  type ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";

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
        providerKey: account?.provider_key ?? initialProviderKey ?? undefined,
        account: account ?? undefined,
      }),
    );
  }, [account, initialProviderKey, open, registry]);

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
              setState((current) => {
                const currentProviderName = supportedProviders.find(
                  (provider) => provider.provider_key === current.providerKey,
                )?.name;
                return {
                  providerKey: nextProvider?.provider_key ?? "",
                  methodKey: nextProvider?.methods[0]?.method_key ?? "",
                  displayName: syncDisplayNameOnProviderChange({
                    currentDisplayName: current.displayName,
                    currentProviderName,
                    nextProviderName: nextProvider?.name,
                  }),
                  configValues: Object.fromEntries(
                    (nextProvider?.methods[0]?.fields ?? [])
                      .filter((field) => field.kind === "config" && field.input === "boolean")
                      .map((field) => [field.key, false]),
                  ),
                  secretValues: {},
                };
              });
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
