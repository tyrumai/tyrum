import { type OperatorCore, type Pairing } from "@tyrum/operator-core";
import type { NodeInventoryEntry } from "@tyrum/schemas";
import { Link2 } from "lucide-react";
import { useMemo } from "react";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Badge, type BadgeVariant } from "../ui/badge.js";
import { Card } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { cn } from "../../lib/cn.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { ApprovedPairingCard, PendingPairingCard } from "./pairing-page.cards.js";
import { resolveAttachmentKind } from "./pairing-page.shared.js";
import { useNodeInventory } from "./pairing-page.inventory.js";

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

export function PairingPage({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const pairing = useOperatorStore(core.pairingStore);
  const chat = useOperatorStore(core.chatStore);
  const blockedPairingIds = pairing.blockedIds ?? pairing.pendingIds;
  const inventory = useNodeInventory({
    core,
    connected:
      connection.status === "connected" ||
      (connection.status === "connecting" && connection.recovering),
    activeSession: chat.active.session,
    refreshAt: pairing.lastSyncedAt,
  });

  const pending = useMemo(
    () =>
      blockedPairingIds
        .map((pairingId) => pairing.byId[pairingId])
        .filter((entry): entry is Pairing => entry !== undefined),
    [blockedPairingIds, pairing.byId],
  );

  const approved = useMemo(
    () => Object.values(pairing.byId).filter((entry) => entry.status === "approved"),
    [pairing.byId],
  );
  const connectedNodes = useMemo(
    () => inventory.nodes.filter((entry) => entry.connected),
    [inventory.nodes],
  );

  return (
    <AppPage contentClassName="max-w-5xl gap-5">
      {inventory.error ? (
        <Alert variant="error" title="Live node status unavailable" description={inventory.error} />
      ) : null}

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-fg">Connected nodes</h2>
          <span className="text-sm text-fg-muted">{connectedNodes.length} live now</span>
        </div>
        {inventory.loading && inventory.nodes.length === 0 ? (
          <Card>
            <div className="px-6 py-5 text-sm text-fg-muted">Loading connected nodes...</div>
          </Card>
        ) : connectedNodes.length === 0 ? (
          <Card>
            <EmptyState
              data-testid="pairing-connected-empty-state"
              icon={Link2}
              title="No connected nodes"
              description="Connected nodes will appear here when devices are online."
            />
          </Card>
        ) : (
          <Card data-testid="pairing-connected-section">
            <div className="divide-y divide-border">
              {connectedNodes.map((node) => {
                const pairingStatus = getPairingStatusDisplay(node.paired_status);
                const attachmentKind = resolveAttachmentKind(node, core.deviceId ?? null);

                return (
                  <div
                    key={node.node_id}
                    data-testid={`pairing-connected-node-${node.node_id}`}
                    className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm font-medium text-fg">
                        {node.label ?? (
                          <span className="break-all font-medium text-fg">{node.node_id}</span>
                        )}
                      </div>
                      {node.label ? (
                        <div className="text-xs text-fg-muted">
                          Node <span className="break-all font-medium text-fg">{node.node_id}</span>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
                        {node.mode ? (
                          <span>
                            Mode <span className="font-medium text-fg">{node.mode}</span>
                          </span>
                        ) : null}
                        {node.version ? (
                          <span>
                            Version <span className="font-medium text-fg">{node.version}</span>
                          </span>
                        ) : null}
                        {node.last_seen_at ? (
                          <span>
                            Last seen{" "}
                            <span className="font-medium text-fg">
                              {formatRelativeTime(node.last_seen_at)}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="success">Connected</Badge>
                      <Badge variant={pairingStatus.variant}>{pairingStatus.label}</Badge>
                      {attachmentKind === "local" ? (
                        <Badge className="border-primary/25 bg-primary/10 text-primary">
                          Attached to this UI
                        </Badge>
                      ) : null}
                      {attachmentKind === "lane" ? (
                        <Badge variant="outline">Attached to lane</Badge>
                      ) : null}
                      {node.capabilities.length > 0 ? (
                        <Badge
                          variant="outline"
                          className={cn(node.capabilities.length > 1 && "tabular-nums")}
                        >
                          {node.capabilities.length} capabilities
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      <div className="grid gap-3">
        <h2 className="text-lg font-medium text-fg">Pending node requests</h2>
        {pending.length === 0 ? (
          <Card>
            <EmptyState
              data-testid="pairing-empty-state"
              icon={Link2}
              title="No node requests"
              description="Node requests appear here when devices want to connect."
            />
          </Card>
        ) : (
          <div className="grid gap-4">
            {pending.map((entry) => {
              const inventoryEntry = inventory.byNodeId[entry.node.node_id];
              return (
                <PendingPairingCard
                  key={entry.pairing_id}
                  core={core}
                  pairing={entry}
                  inventory={inventoryEntry}
                  attachmentKind={resolveAttachmentKind(inventoryEntry, core.deviceId ?? null)}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-3">
        <h2 className="text-lg font-medium text-fg">Trusted nodes</h2>
        {approved.length === 0 ? (
          <Card>
            <EmptyState
              data-testid="pairing-approved-empty-state"
              icon={Link2}
              title="No trusted nodes"
              description="Approved nodes appear here after you trust a device."
            />
          </Card>
        ) : (
          <div className="grid gap-4">
            {approved.map((entry) => {
              const inventoryEntry = inventory.byNodeId[entry.node.node_id];
              return (
                <ApprovedPairingCard
                  key={entry.pairing_id}
                  core={core}
                  pairing={entry}
                  inventory={inventoryEntry}
                  attachmentKind={resolveAttachmentKind(inventoryEntry, core.deviceId ?? null)}
                />
              );
            })}
          </div>
        )}
      </div>
    </AppPage>
  );
}
