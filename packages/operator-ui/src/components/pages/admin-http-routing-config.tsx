import type { AgentListResult, ObservedTelegramThreadListResult } from "@tyrum/client";
import type { OperatorCore } from "@tyrum/operator-core";
import { History, Pencil, Plus, RefreshCw, Search, Trash2, Undo2, Waypoints } from "lucide-react";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { EmptyState } from "../ui/empty-state.js";
import { Input } from "../ui/input.js";
import { useAdminHttpClient, useAdminMutationAccess } from "./admin-http-shared.js";
import {
  asChannelRoutingApi,
  getTelegramAccounts,
  isTelegramChannelConfig,
  type ChannelRoutingConfig,
  type ChannelRoutingRevisionSummary,
  type TelegramChannelConfig,
} from "./admin-http-channels.shared.js";
import { AdminHttpChannelConfigsPanel } from "./admin-http-telegram-connection.js";
import { RoutingRuleDialog, type RoutingAgentOption } from "./admin-http-routing-config-dialog.js";
import {
  buildTelegramThreadKey,
  buildRoutingRuleRows,
  countRoutingRules,
  filterRoutingRuleRows,
  removeRoutingRule,
  upsertRoutingRule,
  type RoutingRuleDraft,
  type RoutingRuleRow,
} from "./admin-http-routing-config.shared.js";

function buildAgentOptions(agents: AgentListResult["agents"]): RoutingAgentOption[] {
  return agents.map((agent) => ({
    key: agent.agent_key,
    label:
      agent.persona.name.trim().toLowerCase() === agent.agent_key.trim().toLowerCase()
        ? agent.agent_key
        : `${agent.agent_key} · ${agent.persona.name}`,
  }));
}

async function loadAgentOptions(core: OperatorCore): Promise<RoutingAgentOption[]> {
  if (core.http.agentList) {
    const result = await core.http.agentList.get({ include_default: true });
    return buildAgentOptions(result.agents);
  }
  if (core.http.agents) {
    const result = await core.http.agents.list();
    return buildAgentOptions(result.agents);
  }
  return [];
}

function formatTimestamp(value?: string): string {
  if (!value) return "Not seen";
  return value.replace("T", " ").replace(".000Z", "Z");
}

function describeRule(row: RoutingRuleRow): string {
  if (row.kind === "default") {
    return `All unmatched Telegram chats on ${row.accountKey}`;
  }
  return row.sessionTitle ?? row.threadId ?? "Unknown thread";
}

export function AdminHttpRoutingConfigPanel({ core }: { core: OperatorCore }): React.ReactElement {
  const mutationHttp = useAdminHttpClient() ?? core.http;
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const [filterValue, setFilterValue] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [config, setConfig] = React.useState<ChannelRoutingConfig>({ v: 1 });
  const [revisions, setRevisions] = React.useState<ChannelRoutingRevisionSummary[]>([]);
  const [observedThreads, setObservedThreads] = React.useState<
    ObservedTelegramThreadListResult["threads"]
  >([]);
  const [channelConfigs, setChannelConfigs] = React.useState<TelegramChannelConfig[]>([]);
  const [agentOptions, setAgentOptions] = React.useState<RoutingAgentOption[]>([]);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingRow, setEditingRow] = React.useState<RoutingRuleRow | null>(null);
  const [deletingRow, setDeletingRow] = React.useState<RoutingRuleRow | null>(null);
  const [revertingRevision, setRevertingRevision] =
    React.useState<ChannelRoutingRevisionSummary | null>(null);

  const loadPanelData = async (busyState: "loading" | "refreshing"): Promise<void> => {
    const routingApi = asChannelRoutingApi(core.http.routingConfig);
    if (!routingApi?.listChannelConfigs) {
      setErrorMessage("Channels config API unavailable.");
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (busyState === "loading") {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setErrorMessage(null);

    try {
      const [current, revisionResult, observedThreadResult, channelConfigResult, agents] =
        await Promise.all([
          routingApi.get(),
          routingApi.listRevisions({ limit: 20 }),
          routingApi.listObservedTelegramThreads({ limit: 200 }),
          routingApi.listChannelConfigs(),
          loadAgentOptions(core),
        ]);
      setConfig(current.config as ChannelRoutingConfig);
      setRevisions(revisionResult.revisions as ChannelRoutingRevisionSummary[]);
      setObservedThreads(observedThreadResult.threads);
      setChannelConfigs(channelConfigResult.channels.filter(isTelegramChannelConfig));
      setAgentOptions(agents);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  React.useEffect(() => {
    void loadPanelData("loading");
    // Intentional: initial load should only run when the core instance changes.
  }, [core]);

  const allRows = buildRoutingRuleRows(config, observedThreads);
  const rows = filterRoutingRuleRows(allRows, filterValue);
  const configuredTelegramAccounts = channelConfigs
    .map((channelConfig) => channelConfig.account_key)
    .toSorted((left, right) => left.localeCompare(right));
  const configuredThreadIds = new Set(
    Object.entries(getTelegramAccounts(config)).flatMap(([accountKey, accountConfig]) =>
      Object.keys(accountConfig.threads ?? {}).map((threadId) =>
        buildTelegramThreadKey(accountKey, threadId),
      ),
    ),
  );
  const editingThreadKey =
    editingRow?.kind === "thread" && editingRow.threadId
      ? buildTelegramThreadKey(editingRow.accountKey, editingRow.threadId)
      : null;
  const availableThreads = observedThreads.filter(
    (thread) =>
      !configuredThreadIds.has(buildTelegramThreadKey(thread.account_key, thread.thread_id)) ||
      buildTelegramThreadKey(thread.account_key, thread.thread_id) === editingThreadKey,
  );
  const defaultAccountOptions = configuredTelegramAccounts.filter((accountKey) => {
    const hasDefault = Boolean(getTelegramAccounts(config)[accountKey]?.default_agent_key);
    return !hasDefault || (editingRow?.kind === "default" && editingRow.accountKey === accountKey);
  });
  const canCreateRules = configuredTelegramAccounts.length > 0;

  const refresh = (): void => {
    void loadPanelData("refreshing");
  };

  const handleChannelConfigsChanged = (): void => {
    refresh();
  };

  const openCreateDialog = (): void => {
    if (!canMutate) {
      requestEnter();
      return;
    }
    setEditingRow(null);
    setDialogOpen(true);
  };

  const openEditDialog = (row: RoutingRuleRow): void => {
    if (!canMutate) {
      requestEnter();
      return;
    }
    setEditingRow(row);
    setDialogOpen(true);
  };

  const saveRule = async (draft: RoutingRuleDraft): Promise<void> => {
    const routingApi = asChannelRoutingApi(mutationHttp.routingConfig);
    if (!routingApi) {
      throw new Error("Channels config API unavailable.");
    }
    await routingApi.update({
      config: upsertRoutingRule(config, draft, editingRow),
    });
    setEditingRow(null);
    await loadPanelData("refreshing");
  };

  const removeRule = async (): Promise<void> => {
    if (!deletingRow) return;
    const routingApi = asChannelRoutingApi(mutationHttp.routingConfig);
    if (!routingApi) {
      throw new Error("Channels config API unavailable.");
    }
    await routingApi.update({
      config: removeRoutingRule(config, deletingRow),
    });
    setDeletingRow(null);
    await loadPanelData("refreshing");
  };

  const revertRevision = async (): Promise<void> => {
    if (!revertingRevision) return;
    const routingApi = asChannelRoutingApi(mutationHttp.routingConfig);
    if (!routingApi) {
      throw new Error("Channels config API unavailable.");
    }
    await routingApi.revert({ revision: revertingRevision.revision });
    setRevertingRevision(null);
    await loadPanelData("refreshing");
  };

  return (
    <section className="grid gap-4" data-testid="admin-http-routing-config">
      <div className="text-sm font-medium text-fg">Channels</div>

      <AdminHttpChannelConfigsPanel
        core={core}
        onChannelConfigsChanged={handleChannelConfigsChanged}
      />

      <Card>
        <CardHeader className="pb-2.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <div className="text-sm font-medium text-fg">Telegram routing rules</div>
              <div className="text-sm text-fg-muted">
                Configure which agent handles Telegram chats using account-aware structured routing
                rules.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                data-testid="channels-refresh"
                isLoading={refreshing}
                onClick={refresh}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
                <Button
                  data-testid="channels-add-open"
                  disabled={!canCreateRules}
                  onClick={openCreateDialog}
                >
                  <Plus className="h-4 w-4" />
                  Add rule
                </Button>
              </ElevatedModeTooltip>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {errorMessage ? (
            <Alert variant="error" title="Channels routing failed" description={errorMessage} />
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Input
              label="Filter rules"
              data-testid="channels-filter"
              value={filterValue}
              onChange={(event) => {
                setFilterValue(event.currentTarget.value);
              }}
              placeholder="Search by thread, agent, account, or rule type"
              suffix={<Search className="h-4 w-4" aria-hidden="true" />}
            />
            <div className="text-sm text-fg-muted">
              {allRows.length} configured rule{allRows.length === 1 ? "" : "s"}
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-fg-muted">Loading channels routing…</div>
          ) : allRows.length === 0 ? (
            <EmptyState
              icon={Waypoints}
              title="No Telegram routing rules configured"
              description={
                canCreateRules
                  ? "Add a default route or a thread override to make Telegram routing explicit."
                  : "Add a Telegram channel first, then create a default route or thread override."
              }
              action={canCreateRules ? { label: "Add rule", onClick: openCreateDialog } : undefined}
            />
          ) : rows.length === 0 ? (
            <Alert
              variant="info"
              title="No routing rules match the current filter"
              description="Clear or change the filter to see the configured Telegram rules."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-bg-subtle text-fg-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Channel</th>
                    <th className="px-3 py-2 font-medium">Account</th>
                    <th className="px-3 py-2 font-medium">Rule</th>
                    <th className="px-3 py-2 font-medium">Thread</th>
                    <th className="px-3 py-2 font-medium">Container</th>
                    <th className="px-3 py-2 font-medium">Agent</th>
                    <th className="px-3 py-2 font-medium">Last active</th>
                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="px-3 py-3 align-top">
                        <Badge variant="outline">telegram</Badge>
                      </td>
                      <td className="px-3 py-3 align-top text-fg">{row.accountKey}</td>
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium text-fg">
                          {row.kind === "default" ? "Default route" : "Thread override"}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium text-fg">{describeRule(row)}</div>
                        {row.threadId ? (
                          <div className="text-xs text-fg-muted">Thread ID: {row.threadId}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 align-top text-fg-muted">
                        {row.kind === "default" ? "Any" : (row.containerKind ?? "Unknown")}
                      </td>
                      <td className="px-3 py-3 align-top text-fg">{row.agentKey}</td>
                      <td className="px-3 py-3 align-top text-fg-muted" title={row.lastActiveAt}>
                        {formatTimestamp(row.lastActiveAt)}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex justify-end gap-1">
                          <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Edit ${describeRule(row)}`}
                              onClick={() => {
                                openEditDialog(row);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </ElevatedModeTooltip>
                          <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Remove ${describeRule(row)}`}
                              onClick={() => {
                                if (!canMutate) {
                                  requestEnter();
                                  return;
                                }
                                setDeletingRow(row);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </ElevatedModeTooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2.5">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-fg-muted" />
            <div className="text-sm font-medium text-fg">History</div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {loading ? (
            <div className="text-sm text-fg-muted">Loading routing history…</div>
          ) : revisions.length === 0 ? (
            <Alert
              variant="info"
              title="No routing revisions yet"
              description="The revision browser will appear here after the first routing change."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-bg-subtle text-fg-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Revision</th>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Reason</th>
                    <th className="px-3 py-2 font-medium">Rules</th>
                    <th className="px-3 py-2 font-medium">Reverted from</th>
                    <th className="px-3 py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {revisions.map((revision) => (
                    <tr key={revision.revision} className="border-t border-border">
                      <td className="px-3 py-3 align-top font-medium text-fg">
                        #{revision.revision}
                      </td>
                      <td className="px-3 py-3 align-top text-fg-muted" title={revision.created_at}>
                        {formatTimestamp(revision.created_at)}
                      </td>
                      <td className="px-3 py-3 align-top text-fg-muted">
                        {revision.reason ?? "No reason recorded"}
                      </td>
                      <td className="px-3 py-3 align-top text-fg-muted">
                        {countRoutingRules(revision.config)}
                      </td>
                      <td className="px-3 py-3 align-top text-fg-muted">
                        {revision.reverted_from_revision ?? "—"}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <div className="flex justify-end">
                          <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Revert to revision ${revision.revision}`}
                              onClick={() => {
                                if (!canMutate) {
                                  requestEnter();
                                  return;
                                }
                                setRevertingRevision(revision);
                              }}
                            >
                              <Undo2 className="h-4 w-4" />
                            </Button>
                          </ElevatedModeTooltip>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <RoutingRuleDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingRow(null);
          }
        }}
        row={editingRow}
        defaultAccountOptions={defaultAccountOptions}
        agents={agentOptions}
        observedThreads={availableThreads}
        onSubmit={saveRule}
        canMutate={canMutate}
      />

      <ConfirmDangerDialog
        open={deletingRow !== null}
        onOpenChange={(open) => {
          if (open) return;
          setDeletingRow(null);
        }}
        title="Remove routing rule"
        description={
          deletingRow
            ? `Remove the ${deletingRow.kind === "default" ? "default route" : "thread override"} for ${describeRule(deletingRow)}.`
            : undefined
        }
        confirmLabel="Remove rule"
        onConfirm={removeRule}
      />

      <ConfirmDangerDialog
        open={revertingRevision !== null}
        onOpenChange={(open) => {
          if (open) return;
          setRevertingRevision(null);
        }}
        title="Revert routing revision"
        description={
          revertingRevision
            ? `Revert Telegram routing to revision ${revertingRevision.revision}.`
            : undefined
        }
        confirmLabel="Revert revision"
        onConfirm={revertRevision}
      />
    </section>
  );
}
