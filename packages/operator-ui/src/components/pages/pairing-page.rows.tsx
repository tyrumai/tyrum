import type { OperatorCore, Pairing } from "@tyrum/operator-core";
import type { NodeInventoryEntry } from "@tyrum/schemas";
import { Badge, type BadgeVariant } from "../ui/badge.js";
import { Button } from "../ui/button.js";
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

export function getStateDisplay(state: NodeListState): { label: string; variant: BadgeVariant } {
  switch (state) {
    case "pending":
      return { label: "Pending", variant: "warning" };
    case "connected":
      return { label: "Connected", variant: "success" };
    case "offline":
      return { label: "Offline", variant: "outline" };
  }
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

export function ExpandedRowDetails({ core, row }: { core: OperatorCore; row: NodeListRow }) {
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
