import type { OperatorRecentRunRow } from "@tyrum/operator-app";
import * as React from "react";
import { DataTable, type DataTableColumn } from "../ui/data-table.js";
import { StatusDot, type StatusDotVariant } from "../ui/status-dot.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

function shortId(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.slice(0, 8) : "unknown";
}

function getRunStateDotVariant(status: OperatorRecentRunRow["runStatus"]): StatusDotVariant {
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
  rows: readonly OperatorRecentRunRow[];
  onRowClick?: (row: OperatorRecentRunRow) => void;
}): React.ReactElement {
  const columns = React.useMemo<DataTableColumn<OperatorRecentRunRow>[]>(
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
          <div className="grid min-w-0 max-w-[12rem] gap-0.5" title={row.source.title}>
            <div className="text-fg">{row.source.label}</div>
            {row.source.detail ? (
              <div className="break-words text-xs text-fg-muted">{row.source.detail}</div>
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
        cell: (row) => (
          <span className="inline-flex items-center gap-2">
            <StatusDot aria-hidden={true} variant={getRunStateDotVariant(row.runStatus)} />
            <span className="font-medium text-fg">{row.runStatus}</span>
          </span>
        ),
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
    <DataTable<OperatorRecentRunRow>
      data-testid="dashboard-recent-runs-table"
      columns={columns}
      data={rows}
      rowKey={(row) => row.id}
      testIdPrefix="dashboard-recent-run-row"
      onRowClick={onRowClick}
      rowAriaLabel={(row) => `Open ${row.agentName} ${row.source.label} run ${shortId(row.runId)}`}
    />
  );
}
