import type { OperatorCore } from "@tyrum/operator-core";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { EmptyState } from "../ui/empty-state.js";
import {
  useAdminHttpClient,
  useAdminMutationAccess,
  useAdminMutationHttpClient,
} from "./admin-http-shared.js";
import { ChannelAccountDialog } from "./admin-http-channels-dialog.js";
import {
  loadAgentOptions,
  renderConfiguredBadges,
  type AgentOption,
  type ChannelRegistryEntry,
  type ConfiguredChannelAccount,
  type ConfiguredChannelGroup,
} from "./admin-http-channels-shared.js";

export function AdminHttpChannelsPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const readHttp = useAdminHttpClient();
  const mutationHttp = useAdminMutationHttpClient();
  const { canMutate, requestEnter } = useAdminMutationAccess(core);

  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [registry, setRegistry] = React.useState<ChannelRegistryEntry[]>([]);
  const [groups, setGroups] = React.useState<ConfiguredChannelGroup[]>([]);
  const [agentOptions, setAgentOptions] = React.useState<AgentOption[]>([]);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingAccount, setEditingAccount] = React.useState<ConfiguredChannelAccount | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ConfiguredChannelAccount | null>(null);

  const readApi = readHttp.channelConfig ?? null;
  const mutationApi = mutationHttp?.channelConfig ?? null;

  const refresh = React.useCallback(async () => {
    if (!readApi) {
      setErrorMessage("Channels config API unavailable.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setRefreshing(true);
    setErrorMessage(null);
    try {
      const [registryResult, channelsResult, nextAgentOptions] = await Promise.all([
        readApi.listRegistry(),
        readApi.listChannels(),
        loadAgentOptions(readHttp),
      ]);
      setRegistry(registryResult.channels);
      setGroups(channelsResult.channels);
      setAgentOptions(nextAgentOptions);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [readApi, readHttp]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = async (): Promise<void> => {
    if (!mutationApi || !deleteTarget) {
      throw new Error("Channels config API unavailable.");
    }
    if (!canMutate) {
      requestEnter();
      throw new Error("Authorize admin access to change channel settings.");
    }
    await mutationApi.deleteAccount(deleteTarget.channel, deleteTarget.account_key);
    toast.success(`Removed ${deleteTarget.channel} account ${deleteTarget.account_key}.`);
    setDeleteTarget(null);
    await refresh();
  };

  return (
    <section className="grid gap-4" data-testid="admin-http-channels">
      <Alert
        variant="info"
        title="Account config is the source of truth"
        description="Each channel account stores its own target agent, access rules, and secrets. Friendly usernames or labels resolve to canonical IDs when credentials are available."
      />

      <Card>
        <CardHeader className="pb-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <div className="text-sm font-medium text-fg">Configured channels</div>
              <div className="text-sm text-fg-muted">
                Only channels with complete Tyrum setup metadata are shown here.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                data-testid="channels-refresh"
                isLoading={refreshing}
                onClick={() => {
                  void refresh();
                }}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
                <Button
                  data-testid="channels-add-open"
                  onClick={() => {
                    if (!canMutate) {
                      requestEnter();
                      return;
                    }
                    setEditingAccount(null);
                    setDialogOpen(true);
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
            <div className="text-sm text-fg-muted">Loading configured channels…</div>
          ) : groups.length === 0 ? (
            <EmptyState
              icon={Plus}
              title="No channel accounts configured"
              description="Add Telegram, Discord, or Google Chat accounts from the unified setup flow."
              action={{
                label: "Add channel",
                onClick: () => {
                  if (!canMutate) {
                    requestEnter();
                    return;
                  }
                  setEditingAccount(null);
                  setDialogOpen(true);
                },
              }}
            />
          ) : (
            <div className="grid gap-4">
              {groups.map((group) => {
                const entry = registry.find((candidate) => candidate.channel === group.channel);
                return (
                  <div key={group.channel} className="grid gap-3">
                    <div className="grid gap-1">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-fg">{group.name}</div>
                        <Badge variant="outline">{group.channel}</Badge>
                      </div>
                      {group.doc ? <div className="text-sm text-fg-muted">{group.doc}</div> : null}
                    </div>

                    <div className="grid gap-3">
                      {group.accounts.map((account) => (
                        <Card
                          key={`${account.channel}:${account.account_key}`}
                          data-testid={`channels-account-card-${account.channel}-${account.account_key}`}
                        >
                          <CardContent className="grid gap-3 pt-6">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="grid gap-1">
                                <div className="text-sm font-medium text-fg">
                                  {account.account_key}
                                </div>
                                <div className="text-sm text-fg-muted">
                                  Last updated{" "}
                                  {account.updated_at.replace("T", " ").replace(".000Z", "Z")}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {renderConfiguredBadges(entry, account)}
                              </div>
                            </div>

                            {account.channel === "telegram" &&
                            account.config["polling_status"] === "error" &&
                            (typeof account.config["polling_last_error_message"] === "string" ||
                              typeof account.config["polling_last_error_at"] === "string") ? (
                              <Alert
                                variant="warning"
                                title="Telegram polling issue"
                                description={[
                                  typeof account.config["polling_last_error_message"] === "string"
                                    ? String(account.config["polling_last_error_message"])
                                    : null,
                                  typeof account.config["polling_last_error_at"] === "string"
                                    ? `Last error at ${String(account.config["polling_last_error_at"])}`
                                    : null,
                                ]
                                  .filter((value): value is string => Boolean(value))
                                  .join(" · ")}
                              />
                            ) : null}

                            <div className="flex flex-wrap justify-end gap-2">
                              <ElevatedModeTooltip
                                canMutate={canMutate}
                                requestEnter={requestEnter}
                              >
                                <Button
                                  variant="secondary"
                                  aria-label={`Edit ${account.channel} ${account.account_key}`}
                                  onClick={() => {
                                    if (!canMutate) {
                                      requestEnter();
                                      return;
                                    }
                                    setEditingAccount(account);
                                    setDialogOpen(true);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </Button>
                              </ElevatedModeTooltip>
                              <ElevatedModeTooltip
                                canMutate={canMutate}
                                requestEnter={requestEnter}
                              >
                                <Button
                                  variant="danger"
                                  aria-label={`Delete ${account.channel} ${account.account_key}`}
                                  onClick={() => {
                                    if (!canMutate) {
                                      requestEnter();
                                      return;
                                    }
                                    setDeleteTarget(account);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </Button>
                              </ElevatedModeTooltip>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ChannelAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        registry={registry}
        groups={groups}
        account={editingAccount}
        agentOptions={agentOptions}
        api={mutationApi}
        canMutate={canMutate}
        requestEnter={requestEnter}
        onSaved={async () => {
          await refresh();
          toast.success(
            editingAccount
              ? `Saved ${editingAccount.channel} account ${editingAccount.account_key}.`
              : "Added channel account.",
          );
        }}
      />

      <ConfirmDangerDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
          }
        }}
        title="Delete channel account"
        description={
          deleteTarget
            ? `Remove the ${deleteTarget.channel} account ${deleteTarget.account_key}.`
            : "Remove this channel account."
        }
        confirmLabel="Delete channel"
        onConfirm={handleDelete}
      />
    </section>
  );
}
