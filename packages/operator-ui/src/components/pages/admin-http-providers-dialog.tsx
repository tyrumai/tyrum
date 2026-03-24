import * as React from "react";
import { toast } from "sonner";
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
  getBooleanConfigDefaults,
  getFieldBooleanValue,
  getFieldStringValue,
  normalizeFormState,
  reconcileProviderFormState,
  selectProviderFormState,
  validateProviderForm,
  type ConfiguredProviderAccount,
  type ConfiguredProviderGroup,
  type ProviderFormState,
  type ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";
import { ProviderPickerField } from "./provider-picker-field.js";

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
  const [autoSelectReady, setAutoSelectReady] = React.useState(false);

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

  React.useEffect(() => {
    if (!open) {
      setAutoSelectReady(false);
      return;
    }
    setAutoSelectReady(false);
    setProviderFilter("");
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
      setState((current) => {
        return selectProviderFormState({
          currentState: current,
          providerKey,
          supportedProviders,
        });
      });
    },
    [supportedProviders],
  );

  React.useEffect(() => {
    if (!open || account || !autoSelectReady) return;
    setState((current) =>
      reconcileProviderFormState({
        currentState: current,
        filteredProviders: filteredSupportedProviders,
        supportedProviders,
      }),
    );
  }, [account, autoSelectReady, filteredSupportedProviders, open, supportedProviders]);

  const formError = validateProviderForm(state, selectedMethod, mode);

  const submit = async (): Promise<void> => {
    if (!canMutate) {
      throw new Error("Authorize admin access to configure providers.");
    }
    if (!selectedProvider || !selectedMethod) {
      toast.error("Unable to save", {
        description: "Choose a supported provider and authentication method.",
      });
      return;
    }
    if (formError) {
      toast.error("Unable to save", { description: formError });
      return;
    }

    setSaving(true);
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
      toast.error("Unable to save", { description: formatErrorMessage(error) });
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
            <ProviderPickerField
              configuredProviders={configuredProviders}
              filteredProviders={filteredSupportedProviders}
              onProviderFilterChange={setProviderFilter}
              onSelectProvider={applyProviderSelection}
              providerFilter={providerFilter}
              selectedProviderKey={state.providerKey}
            />
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
                const methodKey = event.currentTarget.value;
                const nextMethod = selectedProvider.methods.find(
                  (method) => method.method_key === methodKey,
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
              const displayName = event.currentTarget.value;
              setState((current) => ({
                ...current,
                displayName,
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
