import type { OperatorCore } from "@tyrum/operator-core";
import { Plus, RefreshCw } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import {
  asChannelRoutingApi,
  isTelegramChannelConfig,
  removeConfig,
  replaceConfig,
  sortChannelConfigs,
  type TelegramChannelConfig,
} from "./admin-http-channels.shared.js";
import { CreateChannelDialog, TelegramChannelCard } from "./admin-http-channel-instance.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { LoadingState } from "../ui/loading-state.js";
import {
  useAdminHttpClient,
  useAdminMutationAccess,
  useAdminMutationHttpClient,
} from "./admin-http-shared.js";

export function AdminHttpChannelConfigsPanel({
  core,
  onChannelConfigsChanged,
}: {
  core: OperatorCore;
  onChannelConfigsChanged?: () => void;
}): React.ReactElement {
  const readHttp = useAdminHttpClient();
  const mutationHttp = useAdminMutationHttpClient();
  const readApi = asChannelRoutingApi(readHttp.routingConfig);
  const mutationApi = asChannelRoutingApi(mutationHttp?.routingConfig);
  const { canMutate, requestEnter } = useAdminMutationAccess(core);

  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [configs, setConfigs] = React.useState<TelegramChannelConfig[]>([]);
  const [expandedKeys, setExpandedKeys] = React.useState<string[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);

  const refreshConfigs = React.useCallback(async (): Promise<void> => {
    if (!readApi?.listChannelConfigs) {
      setErrorMessage("Channels config API unavailable.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setRefreshing(true);
    setErrorMessage(null);
    try {
      const result = await readApi.listChannelConfigs();
      setConfigs(sortChannelConfigs(result.channels.filter(isTelegramChannelConfig)));
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [readApi]);

  React.useEffect(() => {
    void refreshConfigs();
  }, [refreshConfigs]);

  const toggleExpanded = (accountKey: string): void => {
    setExpandedKeys((current) =>
      current.includes(accountKey)
        ? current.filter((value) => value !== accountKey)
        : [...current, accountKey],
    );
  };

  return (
    <section className="grid gap-4" data-testid="admin-http-channel-configs">
      <Alert
        variant="info"
        title="Changes apply immediately"
        description="Channel config updates are live as soon as they are saved. Secret values remain write-only."
      />

      <Card>
        <CardHeader className="pb-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <div className="text-sm font-medium text-fg">Configured channels</div>
              <div className="text-sm text-fg-muted">
                Manage each configured channel instance independently. Telegram accounts are shown
                as collapsed cards by default.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                data-testid="channels-instance-refresh"
                isLoading={refreshing}
                onClick={() => {
                  void refreshConfigs();
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
                <Button
                  data-testid="channels-instance-add-open"
                  onClick={() => {
                    if (!canMutate) {
                      requestEnter();
                      return;
                    }
                    setCreateDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add channel
                </Button>
              </ElevatedModeTooltip>
            </div>
          </div>
        </CardHeader>

        <CardContent className="grid gap-4">
          {errorMessage ? (
            <Alert
              variant="error"
              title="Unable to load channels"
              description={errorMessage}
              onDismiss={() => setErrorMessage(null)}
            />
          ) : null}

          {loading ? (
            <LoadingState label="Loading configured channels…" />
          ) : configs.length === 0 ? (
            <EmptyState
              icon={Plus}
              title="No channel instances configured"
              description="Add a Telegram account to start configuring channels and account-scoped routing."
              action={{
                label: "Add channel",
                onClick: () => {
                  if (!canMutate) {
                    requestEnter();
                    return;
                  }
                  setCreateDialogOpen(true);
                },
              }}
            />
          ) : (
            <div className="grid gap-3">
              {configs.map((config) => (
                <TelegramChannelCard
                  key={config.account_key}
                  config={config}
                  expanded={expandedKeys.includes(config.account_key)}
                  onToggle={() => {
                    toggleExpanded(config.account_key);
                  }}
                  onUpdated={(nextConfig) => {
                    setConfigs((current) => replaceConfig(current, nextConfig));
                  }}
                  onDeleted={(accountKey) => {
                    setConfigs((current) => removeConfig(current, accountKey));
                    setExpandedKeys((current) => current.filter((value) => value !== accountKey));
                    toast.success(`Removed Telegram account ${accountKey}.`);
                  }}
                  onChannelConfigsChanged={onChannelConfigsChanged}
                  mutationApi={mutationApi}
                  canMutate={canMutate}
                  requestEnter={requestEnter}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateChannelDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        mutationApi={mutationApi}
        canMutate={canMutate}
        requestEnter={requestEnter}
        onCreated={(config) => {
          setConfigs((current) => replaceConfig(current, config));
          setExpandedKeys((current) =>
            current.includes(config.account_key) ? current : [...current, config.account_key],
          );
          toast.success(`Added Telegram account ${config.account_key}.`);
          onChannelConfigsChanged?.();
        }}
      />
    </section>
  );
}
