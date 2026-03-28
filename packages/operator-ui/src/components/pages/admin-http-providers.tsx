import type { OperatorCore } from "@tyrum/operator-app";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import {
  buildReplacementAssignments,
  useAdminHttpClient,
  useAdminMutationAccess,
  useAdminMutationHttpClient,
} from "./admin-http-shared.js";
import { ProviderAccountDialog } from "./admin-http-providers-dialog.js";
import { ProvidersCard, ReplacementAssignmentsFields } from "./admin-http-providers-sections.js";
import type {
  ConfiguredProviderAccount,
  ConfiguredProviderGroup,
  ProviderDeleteDialogState,
  ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";

export function AdminHttpProvidersPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const readHttp = useAdminHttpClient();
  const mutationHttp = useAdminMutationHttpClient();
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
  }, [readHttp]);

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
      if (!mutationHttp) {
        throw new Error("Admin access is required to update provider accounts.");
      }
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
    if (!mutationHttp) {
      throw new Error("Admin access is required to remove provider accounts.");
    }
    await mutationHttp.providerConfig.deleteAccount(deletingAccount.account_key);
    setDeletingAccount(null);
    await refresh();
  };

  const removeProvider = async (): Promise<void> => {
    if (!deletingProvider) return;
    const replacementAssignments = buildReplacementAssignments(
      deletingProvider.requiredExecutionProfileIds,
      deletingProvider.replacementAssignments,
    );
    if (!mutationHttp) {
      throw new Error("Admin access is required to remove providers.");
    }

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
      throw new Error("Select replacement presets or None before removing this provider.");
    }

    setDeletingProvider(null);
    await refresh();
  };

  const unsupportedProviders = registry.filter((provider) => !provider.supported);

  return (
    <section className="grid gap-4" data-testid="admin-http-providers">
      <ProvidersCard
        loading={loading}
        refreshing={refreshing}
        errorMessage={errorMessage}
        unsupportedProviders={unsupportedProviders}
        providers={providers}
        registry={registry}
        canMutate={canMutate}
        actionKey={actionKey}
        onRefresh={() => {
          void refresh();
        }}
        onAddProvider={() => {
          setEditingAccount(null);
          setDialogProviderKey(null);
          setDialogOpen(true);
        }}
        onAddAccount={(providerKey) => {
          setEditingAccount(null);
          setDialogProviderKey(providerKey);
          setDialogOpen(true);
        }}
        onRemoveProvider={(group) => {
          setDeletingProvider({
            group,
            requiredExecutionProfileIds: [],
            replacementAssignments: {},
            candidatePresets: [],
          });
        }}
        onEditAccount={(account) => {
          setDialogProviderKey(null);
          setEditingAccount(account);
          setDialogOpen(true);
        }}
        onToggleAccountStatus={(account, status) => {
          void toggleAccountStatus(account, status);
        }}
        onRemoveAccount={(account) => {
          setDeletingAccount(account);
        }}
        requestEnter={requestEnter}
      />

      {mutationHttp ? (
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
          api={mutationHttp.providerConfig}
        />
      ) : null}

      <ConfirmDangerDialog
        open={deletingAccount !== null}
        onOpenChange={(open) => {
          if (open) return;
          setDeletingAccount(null);
        }}
        title="Remove provider account"
        description={
          deletingAccount
            ? `Remove ${deletingAccount.display_name}. Any pinned conversations will fall back to another account if one exists.`
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
