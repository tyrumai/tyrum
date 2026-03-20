import type {
  AgentListResult,
  ObservedTelegramThreadListResult,
} from "@tyrum/operator-app/browser";
import type { OperatorCore } from "@tyrum/operator-app";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
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
  buildRoutingRuleRows,
  buildTelegramThreadKey,
  describeRule,
  filterRoutingRuleRows,
  removeRoutingRule,
  upsertRoutingRule,
  type RoutingRuleDraft,
  type RoutingRuleRow,
} from "./admin-http-routing-config.shared.js";
import { AdminHttpRoutingHistoryCard } from "./admin-http-routing-history-card.js";
import { AdminHttpRoutingRulesCard } from "./admin-http-routing-rules-card.js";

type AgentHttpClient = Pick<OperatorCore["admin"], "agentList" | "agents">;

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

  return (
    <section className="grid gap-4" data-testid="admin-http-routing-config">
      <div className="text-sm font-medium text-fg">Channels</div>

      <AdminHttpChannelConfigsPanel
        core={core}
        onChannelConfigsChanged={handleChannelConfigsChanged}
      />

      <AdminHttpRoutingRulesCard
        loading={loading}
        refreshing={refreshing}
        errorMessage={errorMessage}
        allRows={allRows}
        rows={rows}
        filterValue={filterValue}
        canCreateRules={canCreateRules}
        canMutate={canMutate}
        requestEnter={requestEnter}
        onFilterChange={setFilterValue}
        onRefresh={refresh}
        onCreate={openCreateDialog}
        onEdit={openEditDialog}
        onDelete={setDeletingRow}
        onDismissError={() => setErrorMessage(null)}
      />

      <AdminHttpRoutingHistoryCard
        loading={loading}
        revisions={revisions}
        canMutate={canMutate}
        requestEnter={requestEnter}
        onRevert={setRevertingRevision}
      />

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
