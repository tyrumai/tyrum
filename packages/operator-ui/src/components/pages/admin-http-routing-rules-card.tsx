import { Pencil, Plus, RefreshCw, Search, Trash2, Waypoints } from "lucide-react";
import * as React from "react";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { DataTable, type DataTableColumn } from "../ui/data-table.js";
import { EmptyState } from "../ui/empty-state.js";
import { Input } from "../ui/input.js";
import { LoadingState } from "../ui/loading-state.js";
import {
  describeRule,
  formatTimestamp,
  type RoutingRuleRow,
} from "./admin-http-routing-config.shared.js";

type AdminHttpRoutingRulesCardProps = {
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly errorMessage: string | null;
  readonly allRows: RoutingRuleRow[];
  readonly rows: RoutingRuleRow[];
  readonly filterValue: string;
  readonly canCreateRules: boolean;
  readonly canMutate: boolean;
  readonly requestEnter: () => void;
  readonly onFilterChange: (value: string) => void;
  readonly onRefresh: () => void;
  readonly onCreate: () => void;
  readonly onEdit: (row: RoutingRuleRow) => void;
  readonly onDelete: (row: RoutingRuleRow) => void;
  readonly onDismissError: () => void;
};

export function AdminHttpRoutingRulesCard({
  loading,
  refreshing,
  errorMessage,
  allRows,
  rows,
  filterValue,
  canCreateRules,
  canMutate,
  requestEnter,
  onFilterChange,
  onRefresh,
  onCreate,
  onEdit,
  onDelete,
  onDismissError,
}: AdminHttpRoutingRulesCardProps): React.ReactElement {
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
                onEdit(row);
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
                onDelete(row);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </ElevatedModeTooltip>
        </div>
      ),
    },
  ];

  return (
    <Card data-testid="admin-http-routing-rules-card">
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
              onClick={onRefresh}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <ElevatedModeTooltip canMutate={canMutate} requestEnter={requestEnter}>
              <Button data-testid="channels-add-open" disabled={!canCreateRules} onClick={onCreate}>
                <Plus className="h-4 w-4" />
                Add rule
              </Button>
            </ElevatedModeTooltip>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {errorMessage ? (
          <Alert
            variant="error"
            title="Channels routing failed"
            description={errorMessage}
            onDismiss={onDismissError}
          />
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Input
            label="Filter rules"
            data-testid="channels-filter"
            value={filterValue}
            onChange={(event) => {
              onFilterChange(event.currentTarget.value);
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
            action={canCreateRules ? { label: "Add rule", onClick: onCreate } : undefined}
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
            testIdPrefix="routing-rule-row"
          />
        )}
      </CardContent>
    </Card>
  );
}
