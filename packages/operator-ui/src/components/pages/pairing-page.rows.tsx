import type { OperatorCore, Pairing } from "@tyrum/operator-core";
import type { NodeInventoryEntry } from "@tyrum/schemas";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, type BadgeVariant } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { cn } from "../../lib/cn.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { extractTakeoverUrlFromNodeLabel } from "../../utils/takeover-url.js";
import { ApprovedPairingDetails, PendingPairingDetails } from "./pairing-page.cards.js";
import { ConnectionBadges, type AttachmentKind } from "./pairing-page.shared.js";

export type NodeListState = "pending" | "connected" | "offline";

type PairingBackedRow = {
  key: string;
  nodeId: string;
  shortIdentifier: string;
  state: NodeListState;
  mode: string | null;
  toolCount: number;
  lastSeenAt: string | null;
  attachmentKind: AttachmentKind;
  pairing: Pairing;
  inventory?: NodeInventoryEntry;
  detailKind: "pending" | "approved";
};

type InventoryOnlyRow = {
  key: string;
  nodeId: string;
  shortIdentifier: string;
  state: "connected";
  mode: string | null;
  toolCount: number;
  lastSeenAt: string | null;
  attachmentKind: AttachmentKind;
  inventory: NodeInventoryEntry;
  detailKind: "inventory";
};

export type NodeListRow = PairingBackedRow | InventoryOnlyRow;

function getPairingStatusDisplay(status: NodeInventoryEntry["paired_status"]): {
  label: string;
  variant: BadgeVariant;
} {
  switch (status) {
    case "approved":
      return { label: "Trusted", variant: "success" };
    case "awaiting_human":
      return { label: "Awaiting human review", variant: "warning" };
    case "reviewing":
      return { label: "Guardian reviewing", variant: "outline" };
    case "queued":
      return { label: "Guardian queued", variant: "outline" };
    case "denied":
      return { label: "Denied", variant: "danger" };
    case "revoked":
      return { label: "Revoked", variant: "danger" };
    default:
      return { label: "Unpaired", variant: "outline" };
  }
}

function getStateDisplay(state: NodeListState): { label: string; variant: BadgeVariant } {
  switch (state) {
    case "pending":
      return { label: "Pending", variant: "warning" };
    case "connected":
      return { label: "Connected", variant: "success" };
    case "offline":
      return { label: "Offline", variant: "outline" };
  }
}

function RowValue({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1", className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-fg-muted md:hidden">
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ConnectedNodeDetails({
  inventory,
  attachmentKind,
}: {
  inventory: NodeInventoryEntry;
  attachmentKind: AttachmentKind;
}) {
  const pairingStatus = getPairingStatusDisplay(inventory.paired_status);
  const takeoverUrl = extractTakeoverUrlFromNodeLabel(inventory.label);

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium text-fg">Connected node</div>
          <Badge variant={pairingStatus.variant}>{pairingStatus.label}</Badge>
        </div>
        <div className="text-sm text-fg-muted">
          Node <span className="break-all font-medium text-fg">{inventory.node_id}</span>
        </div>
        {inventory.label ? <div className="text-xs text-fg-muted">{inventory.label}</div> : null}
        <ConnectionBadges inventory={inventory} attachmentKind={attachmentKind} />
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fg-muted">
          {inventory.mode ? (
            <span>
              Mode <span className="font-medium text-fg">{inventory.mode}</span>
            </span>
          ) : null}
          {inventory.version ? (
            <span>
              Version <span className="font-medium text-fg">{inventory.version}</span>
            </span>
          ) : null}
          {inventory.last_seen_at ? (
            <span>
              Last seen{" "}
              <span className="font-medium text-fg">
                {formatRelativeTime(inventory.last_seen_at)}
              </span>
            </span>
          ) : null}
          <span>
            Tools{" "}
            <span className="font-medium tabular-nums text-fg">
              {inventory.capabilities.length}
            </span>
          </span>
        </div>
        {takeoverUrl ? (
          <Button asChild size="sm" variant="outline" className="w-fit">
            <a href={takeoverUrl} target="_blank" rel="noreferrer noopener">
              Open takeover
            </a>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">Tools</div>
        {inventory.capabilities.length === 0 ? (
          <div className="text-sm text-fg-muted">No tools advertised.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {inventory.capabilities.map((capability) => (
              <Badge key={capability.capability} variant="outline" className="max-w-full">
                <span className="truncate">{capability.capability}</span>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ExpandedRowDetails({ core, row }: { core: OperatorCore; row: NodeListRow }) {
  switch (row.detailKind) {
    case "pending":
      return (
        <PendingPairingDetails
          core={core}
          pairing={row.pairing}
          inventory={row.inventory}
          attachmentKind={row.attachmentKind}
        />
      );
    case "approved":
      return (
        <ApprovedPairingDetails
          core={core}
          pairing={row.pairing}
          inventory={row.inventory}
          attachmentKind={row.attachmentKind}
        />
      );
    case "inventory":
      return <ConnectedNodeDetails inventory={row.inventory} attachmentKind={row.attachmentKind} />;
  }
}

export function NodeListRowItem({
  core,
  row,
  expanded,
  onToggle,
}: {
  core: OperatorCore;
  row: NodeListRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const stateDisplay = getStateDisplay(row.state);
  const rowDetailsId = `pairing-row-details-${row.nodeId}`;

  return (
    <div data-testid={`pairing-row-${row.nodeId}`} className="divide-y divide-border">
      <button
        type="button"
        data-testid={`pairing-row-toggle-${row.nodeId}`}
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-subtle/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          row.attachmentKind === "local" && "bg-primary/5",
        )}
        aria-expanded={expanded}
        aria-controls={rowDetailsId}
        onClick={onToggle}
      >
        <div className="min-w-0 flex-1 grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,0.6fr)_minmax(0,0.9fr)_minmax(0,0.7fr)] md:items-center">
          <RowValue label="Identifier">
            <div
              className="truncate font-mono text-sm text-fg"
              title={row.nodeId}
              data-testid={`pairing-row-identifier-${row.nodeId}`}
            >
              {row.shortIdentifier}
            </div>
          </RowValue>

          <RowValue label="Mode">
            <div className="truncate text-sm text-fg-muted">{row.mode ?? "-"}</div>
          </RowValue>

          <RowValue label="#tools">
            <div
              className="text-sm tabular-nums text-fg-muted"
              data-testid={`pairing-row-tools-${row.nodeId}`}
            >
              {row.toolCount}
            </div>
          </RowValue>

          <RowValue label="Last seen">
            <div className="truncate text-sm text-fg-muted">
              {row.lastSeenAt ? formatRelativeTime(row.lastSeenAt) : "-"}
            </div>
          </RowValue>

          <RowValue label="State" className="md:justify-self-start">
            <div className="flex items-center gap-2">
              <Badge variant={stateDisplay.variant}>{stateDisplay.label}</Badge>
            </div>
          </RowValue>
        </div>

        <ChevronDown
          aria-hidden={true}
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 text-fg-muted transition-transform",
            expanded ? "rotate-180" : "rotate-0",
          )}
        />
      </button>

      {expanded ? (
        <div
          id={rowDetailsId}
          data-testid={`pairing-row-details-${row.nodeId}`}
          className="bg-bg-subtle/20 px-4 py-4 md:px-5"
        >
          <ExpandedRowDetails core={core} row={row} />
        </div>
      ) : null}
    </div>
  );
}
