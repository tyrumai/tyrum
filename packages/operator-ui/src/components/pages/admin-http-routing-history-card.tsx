import { History, Undo2 } from "lucide-react";
import * as React from "react";
import { ElevatedModeTooltip } from "../elevated-mode/elevated-mode-tooltip.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { DataTable, type DataTableColumn } from "../ui/data-table.js";
import { LoadingState } from "../ui/loading-state.js";
import { useI18n } from "../../i18n-helpers.js";
import type { ChannelRoutingRevisionSummary } from "./admin-http-channels.shared.js";
import { countRoutingRules, formatTimestamp } from "./admin-http-routing-config.shared.js";

type AdminHttpRoutingHistoryCardProps = {
  readonly loading: boolean;
  readonly revisions: ChannelRoutingRevisionSummary[];
  readonly canMutate: boolean;
  readonly requestEnter: () => void;
  readonly onRevert: (revision: ChannelRoutingRevisionSummary) => void;
};

export function AdminHttpRoutingHistoryCard({
  loading,
  revisions,
  canMutate,
  requestEnter,
  onRevert,
}: AdminHttpRoutingHistoryCardProps): React.ReactElement {
  const intl = useI18n();
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
          {formatTimestamp(intl, revision.created_at)}
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
                onRevert(revision);
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
    <Card data-testid="admin-http-routing-history-card">
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
            testIdPrefix="routing-history-row"
          />
        )}
      </CardContent>
    </Card>
  );
}
