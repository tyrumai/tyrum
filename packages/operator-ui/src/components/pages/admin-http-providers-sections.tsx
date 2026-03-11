import * as React from "react";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Select } from "../ui/select.js";
import {
  EXECUTION_PROFILE_LABELS,
  getProviderStatusVariant,
  methodLabel,
  type ConfiguredProviderAccount,
  type ConfiguredProviderGroup,
  type ModelPreset,
  type ProviderRegistryEntry,
} from "./admin-http-providers.shared.js";

export function ReplacementAssignmentsFields({
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

function ProviderAccountCard({
  account,
  group,
  registry,
  canMutate,
  actionKey,
  onEdit,
  onToggleStatus,
  onRemove,
  requestEnter,
}: {
  account: ConfiguredProviderAccount;
  group: ConfiguredProviderGroup;
  registry: ProviderRegistryEntry[];
  canMutate: boolean;
  actionKey: string | null;
  onEdit: (account: ConfiguredProviderAccount) => void;
  onToggleStatus: (
    account: ConfiguredProviderAccount,
    status: ConfiguredProviderAccount["status"],
  ) => void;
  onRemove: (account: ConfiguredProviderAccount) => void;
  requestEnter: () => void;
}): React.ReactElement {
  const nextStatus = account.status === "active" ? "disabled" : "active";

  return (
    <div className="grid gap-3 rounded-lg border border-border bg-bg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium text-fg">{account.display_name}</div>
            <Badge variant={getProviderStatusVariant(account.status)}>{account.status}</Badge>
            <Badge variant="outline">
              {methodLabel(
                registry.find((provider) => provider.provider_key === group.provider_key),
                account.method_key,
              )}
            </Badge>
          </div>
          <div className="break-words text-sm text-fg-muted [overflow-wrap:anywhere]">
            Secrets configured:{" "}
            {account.configured_secret_keys.length > 0
              ? account.configured_secret_keys.join(", ")
              : "none"}
          </div>
        </div>
        <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onEdit(account);
              }}
            >
              Edit
            </Button>
            <Button
              type="button"
              variant="secondary"
              isLoading={actionKey === `${account.account_key}:${nextStatus}`}
              onClick={() => {
                onToggleStatus(account, nextStatus);
              }}
            >
              {account.status === "active" ? "Disable" : "Enable"}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                onRemove(account);
              }}
            >
              Remove
            </Button>
          </div>
        </ElevatedModeTooltip>
      </div>
    </div>
  );
}

function ProviderGroupCard({
  group,
  registry,
  canMutate,
  actionKey,
  onAddAccount,
  onRemoveProvider,
  onEditAccount,
  onToggleAccountStatus,
  onRemoveAccount,
  requestEnter,
}: {
  group: ConfiguredProviderGroup;
  registry: ProviderRegistryEntry[];
  canMutate: boolean;
  actionKey: string | null;
  onAddAccount: (providerKey: string) => void;
  onRemoveProvider: (group: ConfiguredProviderGroup) => void;
  onEditAccount: (account: ConfiguredProviderAccount) => void;
  onToggleAccountStatus: (
    account: ConfiguredProviderAccount,
    status: ConfiguredProviderAccount["status"],
  ) => void;
  onRemoveAccount: (account: ConfiguredProviderAccount) => void;
  requestEnter: () => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2.5">
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
          <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                data-testid={`providers-group-add-account-${group.provider_key}`}
                onClick={() => {
                  onAddAccount(group.provider_key);
                }}
              >
                Add account
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  onRemoveProvider(group);
                }}
              >
                Remove provider
              </Button>
            </div>
          </ElevatedModeTooltip>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 pt-0">
        {group.accounts.map((account) => (
          <ProviderAccountCard
            key={account.account_key}
            account={account}
            group={group}
            registry={registry}
            canMutate={canMutate}
            actionKey={actionKey}
            onEdit={onEditAccount}
            onToggleStatus={onToggleAccountStatus}
            onRemove={onRemoveAccount}
            requestEnter={requestEnter}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export function ProvidersCard({
  loading,
  refreshing,
  errorMessage,
  unsupportedProviders,
  providers,
  registry,
  canMutate,
  actionKey,
  onRefresh,
  onAddProvider,
  onAddAccount,
  onRemoveProvider,
  onEditAccount,
  onToggleAccountStatus,
  onRemoveAccount,
  requestEnter,
}: {
  loading: boolean;
  refreshing: boolean;
  errorMessage: string | null;
  unsupportedProviders: ProviderRegistryEntry[];
  providers: ConfiguredProviderGroup[];
  registry: ProviderRegistryEntry[];
  canMutate: boolean;
  actionKey: string | null;
  onRefresh: () => void;
  onAddProvider: () => void;
  onAddAccount: (providerKey: string) => void;
  onRemoveProvider: (group: ConfiguredProviderGroup) => void;
  onEditAccount: (account: ConfiguredProviderAccount) => void;
  onToggleAccountStatus: (
    account: ConfiguredProviderAccount,
    status: ConfiguredProviderAccount["status"],
  ) => void;
  onRemoveAccount: (account: ConfiguredProviderAccount) => void;
  requestEnter: () => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader className="pb-2.5">
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
              onClick={onRefresh}
            >
              Refresh
            </Button>
            <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
              <Button
                type="button"
                data-testid="providers-add-open"
                disabled={registry.every((provider) => !provider.supported)}
                onClick={() => {
                  onAddProvider();
                }}
              >
                Add provider
              </Button>
            </ElevatedModeTooltip>
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
            <ProviderGroupCard
              key={group.provider_key}
              group={group}
              registry={registry}
              canMutate={canMutate}
              actionKey={actionKey}
              onAddAccount={onAddAccount}
              onRemoveProvider={onRemoveProvider}
              onEditAccount={onEditAccount}
              onToggleAccountStatus={onToggleAccountStatus}
              onRemoveAccount={onRemoveAccount}
              requestEnter={requestEnter}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
