import type { OperatorCore, Pairing } from "@tyrum/operator-core";
import { Link2 } from "lucide-react";
import { useMemo } from "react";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Card } from "../ui/card.js";
import { EmptyState } from "../ui/empty-state.js";
import { useOperatorStore } from "../../use-operator-store.js";
import {
  ApprovedPairingCard,
  PendingPairingCard,
  resolveAttachmentKind,
} from "./pairing-page.cards.js";
import { usePairingPageNodeInventory } from "./pairing-page.inventory.js";

export function PairingPage({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const pairing = useOperatorStore(core.pairingStore);
  const chat = useOperatorStore(core.chatStore);
  const inventory = usePairingPageNodeInventory({
    core,
    connected:
      connection.status === "connected" ||
      (connection.status === "connecting" && connection.recovering),
    activeSession: chat.active.session,
    refreshAt: pairing.lastSyncedAt,
  });

  const pending = useMemo(
    () =>
      pairing.pendingIds
        .map((pairingId) => pairing.byId[pairingId])
        .filter((entry): entry is Pairing => entry !== undefined),
    [pairing.byId, pairing.pendingIds],
  );

  const approved = useMemo(
    () => Object.values(pairing.byId).filter((entry) => entry.status === "approved"),
    [pairing.byId],
  );

  return (
    <AppPage title="Nodes" contentClassName="max-w-5xl gap-5">
      {inventory.error ? (
        <Alert variant="error" title="Live node status unavailable" description={inventory.error} />
      ) : null}

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
