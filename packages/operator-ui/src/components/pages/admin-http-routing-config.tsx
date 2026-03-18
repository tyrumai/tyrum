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
import { DataTable, type DataTableColumn } from "../ui/data-table.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { EmptyState } from "../ui/empty-state.js";
import { Input } from "../ui/input.js";
import { LoadingState } from "../ui/loading-state.js";
import {
  useAdminHttpClient,
  useAdminMutationAccess,
  useAdminMutationHttpClient,
} from "./admin-http-shared.js";
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

type AgentHttpClient = Pick<OperatorCore["http"], "agentList" | "agents">;

function buildAgentOptions(agents: AgentListResult["agents"]): RoutingAgentOption[] {
  return agents.map((agent) => ({
    key: agent.agent_key,
    label:
      agent.persona.name.trim().toLowerCase() === agent.agent_key.trim().toLowerCase()
        ? agent.agent_key
        : `${agent.agent_key} · ${agent.persona.name}`,
  }));
}

async function loadAgentOptions(http: AgentHttpClient): Promise<RoutingAgentOption[]> {
  if (http.agentList) {
    const result = await http.agentList.get({ include_default: true });
    return buildAgentOptions(result.agents);
  }
  if (http.agents) {
    const result = await http.agents.list();
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
  const readHttp = useAdminHttpClient();
  const mutationHttp = useAdminMutationHttpClient();
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
  const mutationRoutingApi = asChannelRoutingApi(mutationHttp?.routingConfig);

  const loadPanelData = async (busyState: "loading" | "refreshing"): Promise<void> => {
    const routingApi = asChannelRoutingApi(readHttp.routingConfig);
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
          loadAgentOptions(readHttp),
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
  }, [readHttp]);

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
    if (!mutationRoutingApi) {
      throw new Error("Channels config API unavailable.");
    }
    await mutationRoutingApi.update({
      config: upsertRoutingRule(config, draft, editingRow),
    });
    setEditingRow(null);
    await loadPanelData("refreshing");
  };

  const removeRule = async (): Promise<void> => {
    if (!deletingRow) return;
    if (!mutationRoutingApi) {
      throw new Error("Channels config API unavailable.");
    }
    await mutationRoutingApi.update({
      config: removeRoutingRule(config, deletingRow),
    });
    setDeletingRow(null);
    await loadPanelData("refreshing");
  };

  const revertRevision = async (): Promise<void> => {
    if (!revertingRevision) return;
    if (!mutationRoutingApi) {
      throw new Error("Channels config API unavailable.");
    }
    await mutationRoutingApi.revert({ revision: revertingRevision.revision });
    setRevertingRevision(null);
    await loadPanelData("refreshing");
  };

  const routingRuleColumns: DataTableColumn<RoutingRuleRow>[] = [
    {
      id: "channel",
      header: "Channel",
      cell: () => <Badge variant="outline">telegram</Badge>,
      cellClassName: "align-top",
    },
    {
      id: "account",
      header: "Account",
      cell: (row) => <span className="text-fg">{row.accountKey}</span>,
      cellClassName: "align-top",
    },
    {
      id: "rule",
      header: "Rule",
      cell: (row) => (
        <div className="font-medium text-fg">
          {row.kind === "default" ? "Default route" : "Thread override"}
        </div>
      ),
      cellClassName: "align-top",
    },
    {
      id: "thread",
      header: "Thread",
      cell: (row) => (
        <>
          <div className="font-medium text-fg">{describeRule(row)}</div>
          {row.threadId ? (
            <div className="text-xs text-fg-muted">Thread ID: {row.threadId}</div>
          ) : null}
        </>
      ),
      cellClassName: "align-top",
    },
    {
      id: "container",
      header: "Container",
      cell: (row) => (
        <span className="text-fg-muted">
          {row.kind === "default" ? "Any" : (row.containerKind ?? "Unknown")}
        </span>
      ),
      cellClassName: "align-top",
    },
    {
      id: "agent",
      header: "Agent",
      cell: (row) => <span className="text-fg">{row.agentKey}</span>,
      cellClassName: "align-top",
    },
    {
      id: "lastActive",
      header: "Last active",
      cell: (row) => (
        <span className="text-fg-muted" title={row.lastActiveAt}>
          {formatTimestamp(row.lastActiveAt)}
        </span>
      ),
      cellClassName: "align-top",
    },
    {
      id: "actions",
      header: "Actions",
      headerClassName: "text-right",
      cellClassName: "align-top text-right",
      cell: (row) => (
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
      ),
    },
  ];

  const revisionColumns: DataTableColumn<ChannelRoutingRevisionSummary>[] = [
    {
      id: "revision",
      header: "Revision",
      cell: (revision) => <span className="font-medium text-fg">#{revision.revision}</span>,
      cellClassName: "align-top",
    },
    {
      id: "when",
      header: "When",
      cell: (revision) => (
        <span className="text-fg-muted" title={revision.created_at}>
          {formatTimestamp(revision.created_at)}
        </span>
      ),
      cellClassName: "align-top",
    },
    {
      id: "reason",
      header: "Reason",
      cell: (revision) => (
        <span className="text-fg-muted">{revision.reason ?? "No reason recorded"}</span>
      ),
      cellClassName: "align-top",
    },
    {
      id: "rules",
      header: "Rules",
      cell: (revision) => (
        <span className="text-fg-muted">{countRoutingRules(revision.config)}</span>
      ),
      cellClassName: "align-top",
    },
    {
      id: "revertedFrom",
      header: "Reverted from",
      cell: (revision) => (
        <span className="text-fg-muted">{revision.reverted_from_revision ?? "—"}</span>
      ),
      cellClassName: "align-top",
    },
    {
      id: "actions",
      header: "Actions",
      headerClassName: "text-right",
      cellClassName: "align-top text-right",
      cell: (revision) => (
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
      ),
    },
  ];

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
            <LoadingState label="Loading channels routing…" />
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
            <DataTable<RoutingRuleRow>
              columns={routingRuleColumns}
              data={rows}
              rowKey={(row) => row.id}
            />
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
            <LoadingState label="Loading routing history…" />
          ) : revisions.length === 0 ? (
            <Alert
              variant="info"
              title="No routing revisions yet"
              description="The revision browser will appear here after the first routing change."
            />
          ) : (
            <DataTable<ChannelRoutingRevisionSummary>
              columns={revisionColumns}
              data={revisions}
              rowKey={(revision) => String(revision.revision)}
            />
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
