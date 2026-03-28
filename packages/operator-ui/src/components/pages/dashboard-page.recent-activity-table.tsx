import type { OperatorRecentActivityRow } from "@tyrum/operator-app";
import * as React from "react";
import { DataTable, type DataTableColumn } from "../ui/data-table.js";
import { StatusDot, type StatusDotVariant } from "../ui/status-dot.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";

function shortId(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.slice(0, 8) : "unknown";
}

function getTurnStateDotVariant(status: OperatorRecentActivityRow["turnStatus"]): StatusDotVariant {
  if (status === null) {
    return "neutral";
  }
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

export function DashboardRecentActivityTable({
  rows,
  onRowClick,
}: {
  rows: readonly OperatorRecentActivityRow[];
  onRowClick?: (row: OperatorRecentActivityRow) => void;
}): React.ReactElement {
  const columns = React.useMemo<DataTableColumn<OperatorRecentActivityRow>[]>(
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
        id: "conversation",
        header: "Conversation",
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
        id: "turn",
        header: "Turn",
        cell: (row) => (
          <div className="font-medium text-fg">
            {row.turnId ? `Turn ${shortId(row.turnId)}` : "Conversation update"}
          </div>
        ),
        cellClassName: "align-top whitespace-nowrap",
      },
      {
        id: "state",
        header: "Status",
        cell: (row) => (
          <span className="inline-flex items-center gap-2">
            <StatusDot aria-hidden={true} variant={getTurnStateDotVariant(row.turnStatus)} />
            <span className="font-medium text-fg">{row.turnStatus ?? "updated"}</span>
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
    <DataTable<OperatorRecentActivityRow>
      data-testid="dashboard-recent-activity-table"
      columns={columns}
      data={rows}
      rowKey={(row) => row.id}
      testIdPrefix="dashboard-recent-activity-row"
      onRowClick={onRowClick}
      rowAriaLabel={(row) =>
        row.turnId
          ? `Open ${row.agentName} ${row.source.label} turn ${shortId(row.turnId)}`
          : `Open ${row.agentName} ${row.source.label} conversation`
      }
    />
  );
}
