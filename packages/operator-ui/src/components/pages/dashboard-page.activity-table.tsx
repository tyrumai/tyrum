import type { ExecutionRunStatus } from "@tyrum/contracts";
import * as React from "react";
import { DataTable, type DataTableColumn } from "../ui/data-table.js";
import { StatusDot, type StatusDotVariant } from "../ui/status-dot.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

export type DashboardRecentRunRow = {
  id: string;
  agentKey: string;
  agentName: string;
  sessionKey: string | null;
  sourceLabel: string;
  sourceDetail: string | null;
  sourceTitle: string;
  runId: string;
  runAttempt: number;
  lane: string;
  occurredAt: string;
  runStatus: ExecutionRunStatus;
};

function shortId(value: string): string {
  return value.slice(0, 8);
}

function getRunStateDotVariant(status: ExecutionRunStatus): StatusDotVariant {
  switch (status) {
    case "running":
      return "primary";
    case "queued":
    case "paused":
      return "warning";
    case "succeeded":
      return "success";
    case "failed":
    case "cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

export function DashboardRecentRunsTable({
  rows,
  onRowClick,
}: {
  rows: readonly DashboardRecentRunRow[];
  onRowClick?: (row: DashboardRecentRunRow) => void;
}): React.ReactElement {
  const columns = React.useMemo<DataTableColumn<DashboardRecentRunRow>[]>(
    () => [
      {
        id: "agent",
        header: "Agent",
        cell: (row) => (
          <div className="min-w-0 max-w-[10rem] truncate font-medium text-fg" title={row.agentName}>
            {row.agentName}
          </div>
        ),
        cellClassName: "min-w-0 align-top",
      },
      {
        id: "source",
        header: "Source",
        cell: (row) => (
          <div className="grid min-w-0 max-w-[12rem] gap-0.5" title={row.sourceTitle}>
            <div className="text-fg">{row.sourceLabel}</div>
            {row.sourceDetail ? (
              <div className="break-words text-xs text-fg-muted">{row.sourceDetail}</div>
            ) : null}
          </div>
        ),
        cellClassName: "min-w-0 align-top",
      },
      {
        id: "run",
        header: "Run",
        cell: (row) => <div className="font-medium text-fg">Run {shortId(row.runId)}</div>,
        cellClassName: "align-top whitespace-nowrap",
      },
      {
        id: "state",
        header: "State",
        cell: (row) => {
          return (
            <div className="grid gap-0.5">
              <span className="inline-flex items-center gap-2">
                <StatusDot aria-hidden={true} variant={getRunStateDotVariant(row.runStatus)} />
                <span className="font-medium text-fg">{row.runStatus}</span>
              </span>
            </div>
          );
        },
        cellClassName: "align-top whitespace-nowrap",
      },
      {
        id: "when",
        header: "When",
        cell: (row) => (
          <time dateTime={row.occurredAt} title={row.occurredAt} className="text-fg-muted">
            {formatRelativeTime(row.occurredAt)}
          </time>
        ),
        cellClassName: "align-top whitespace-nowrap",
      },
    ],
    [],
  );

  return (
    <DataTable<DashboardRecentRunRow>
      data-testid="dashboard-recent-runs-table"
      columns={columns}
      data={rows}
      rowKey={(row) => row.id}
      testIdPrefix="dashboard-recent-run-row"
      onRowClick={onRowClick}
      rowAriaLabel={(row) => `Open ${row.agentName} ${row.sourceLabel} run ${shortId(row.runId)}`}
    />
  );
}
