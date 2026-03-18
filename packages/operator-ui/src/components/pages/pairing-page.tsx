import {
  isPairingBlockedStatus,
  pairingUpdatedAt,
  type OperatorCore,
  type Pairing,
} from "@tyrum/operator-core";
import type { NodeInventoryEntry } from "@tyrum/schemas";
import { Link2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Card } from "../ui/card.js";
import { DataTable, type DataTableColumn } from "../ui/data-table.js";
import { EmptyState } from "../ui/empty-state.js";
import { Input } from "../ui/input.js";
import { LoadingState } from "../ui/loading-state.js";
import { SectionHeading } from "../ui/section-heading.js";
import { Select } from "../ui/select.js";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import {
  ExpandedRowDetails,
  getStateDisplay,
  type NodeListRow,
  type NodeListState,
} from "./pairing-page.rows.js";
import {
  extractNodeMeta,
  resolveAttachmentKind,
  type AttachmentKind,
} from "./pairing-page.shared.js";
import { useNodeInventory } from "./pairing-page.inventory.js";

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatShortIdentifier(nodeId: string): string {
  if (nodeId.length <= 18) return nodeId;
  return `${nodeId.slice(0, 8)}...${nodeId.slice(-6)}`;
}

function resolveMode(
  pairing: Pairing | undefined,
  inventory: NodeInventoryEntry | undefined,
): string | null {
  if (inventory?.mode) return inventory.mode;
  if (!pairing) return null;
  return extractNodeMeta(pairing.node.metadata).mode;
}

function resolveToolCount(
  pairing: Pairing | undefined,
  inventory: NodeInventoryEntry | undefined,
): number {
  if (inventory) return inventory.capabilities.length;
  if (!pairing) return 0;
  if (pairing.capability_allowlist.length > 0) {
    return pairing.capability_allowlist.length;
  }
  return pairing.node.capabilities.length;
}

function resolveLastSeenAt(
  pairing: Pairing | undefined,
  inventory: NodeInventoryEntry | undefined,
): string | null {
  return inventory?.last_seen_at ?? pairing?.node.last_seen_at ?? null;
}

function compareNodeIds(a: string, b: string): number {
  return a.localeCompare(b);
}

function getAttachmentSortRank(kind: AttachmentKind): number {
  switch (kind) {
    case "local":
      return 0;
    case "lane":
      return 1;
    case "none":
    default:
      return 2;
  }
}

function shouldHideInventoryNode(entry: NodeInventoryEntry): boolean {
  return entry.paired_status === "denied" || entry.paired_status === "revoked";
}

function mergeLatestPairingByNode(target: Map<string, Pairing>, pairing: Pairing): void {
  const current = target.get(pairing.node.node_id);
  if (!current) {
    target.set(pairing.node.node_id, pairing);
    return;
  }

  const nextUpdatedAt = parseTimestamp(pairingUpdatedAt(pairing));
  const currentUpdatedAt = parseTimestamp(pairingUpdatedAt(current));
  if (nextUpdatedAt >= currentUpdatedAt) {
    target.set(pairing.node.node_id, pairing);
  }
}

function buildPairingRow(input: {
  state: NodeListState;
  pairing: Pairing;
  inventory?: NodeInventoryEntry;
  deviceId: string | null;
}): NodeListRow {
  const { inventory, pairing, state, deviceId } = input;
  return {
    key: `pairing:${String(pairing.pairing_id)}`,
    nodeId: pairing.node.node_id,
    shortIdentifier: formatShortIdentifier(pairing.node.node_id),
    state,
    mode: resolveMode(pairing, inventory),
    toolCount: resolveToolCount(pairing, inventory),
    lastSeenAt: resolveLastSeenAt(pairing, inventory),
    attachmentKind: resolveAttachmentKind(inventory, deviceId),
    pairing,
    inventory,
    detailKind: state === "pending" ? "pending" : "approved",
  };
}

function buildInventoryRow(input: {
  inventory: NodeInventoryEntry;
  deviceId: string | null;
}): NodeListRow {
  const { inventory, deviceId } = input;
  return {
    key: `node:${inventory.node_id}`,
    nodeId: inventory.node_id,
    shortIdentifier: formatShortIdentifier(inventory.node_id),
    state: "connected",
    mode: inventory.mode ?? null,
    toolCount: inventory.capabilities.length,
    lastSeenAt: inventory.last_seen_at ?? null,
    attachmentKind: resolveAttachmentKind(inventory, deviceId),
    inventory,
    detailKind: "inventory",
  };
}

function countRowsByState(rows: NodeListRow[]): Record<NodeListState, number> {
  return rows.reduce<Record<NodeListState, number>>(
    (counts, row) => {
      counts[row.state] += 1;
      return counts;
    },
    { pending: 0, connected: 0, offline: 0 },
  );
}

function buildNodeRows(input: {
  pairingById: Record<number, Pairing>;
  inventoryNodes: NodeInventoryEntry[];
  inventoryByNodeId: Record<string, NodeInventoryEntry>;
  deviceId: string | null;
}): NodeListRow[] {
  const { deviceId, inventoryByNodeId, inventoryNodes, pairingById } = input;
  const pairings = Object.values(pairingById);
  const pendingPairings = pairings
    .filter((entry) => isPairingBlockedStatus(entry.status))
    .toSorted((a, b) => {
      const delta = parseTimestamp(pairingUpdatedAt(b)) - parseTimestamp(pairingUpdatedAt(a));
      if (delta !== 0) return delta;
      return compareNodeIds(a.node.node_id, b.node.node_id);
    });
  const approvedPairingsByNodeId = new Map<string, Pairing>();
  for (const pairing of pairings) {
    if (pairing.status !== "approved") continue;
    mergeLatestPairingByNode(approvedPairingsByNodeId, pairing);
  }

  const pendingRows = pendingPairings.map((pairing) =>
    buildPairingRow({
      state: "pending",
      pairing,
      inventory: inventoryByNodeId[pairing.node.node_id],
      deviceId,
    }),
  );
  const pendingNodeIds = new Set(pendingRows.map((row) => row.nodeId));

  const connectedRows: NodeListRow[] = [];
  for (const entry of inventoryNodes) {
    if (!entry.connected) continue;
    if (pendingNodeIds.has(entry.node_id)) continue;
    if (shouldHideInventoryNode(entry)) continue;

    const approvedPairing = approvedPairingsByNodeId.get(entry.node_id);
    connectedRows.push(
      approvedPairing
        ? buildPairingRow({
            state: "connected",
            pairing: approvedPairing,
            inventory: entry,
            deviceId,
          })
        : buildInventoryRow({ inventory: entry, deviceId }),
    );
  }
  const sortedConnectedRows = connectedRows.toSorted((a, b) => {
    const attachmentDelta =
      getAttachmentSortRank(a.attachmentKind) - getAttachmentSortRank(b.attachmentKind);
    if (attachmentDelta !== 0) return attachmentDelta;
    const lastSeenDelta = parseTimestamp(b.lastSeenAt) - parseTimestamp(a.lastSeenAt);
    if (lastSeenDelta !== 0) return lastSeenDelta;
    return compareNodeIds(a.nodeId, b.nodeId);
  });

  const offlineRows = Array.from(approvedPairingsByNodeId.values())
    .filter(
      (pairing) =>
        !pendingNodeIds.has(pairing.node.node_id) &&
        !inventoryByNodeId[pairing.node.node_id]?.connected,
    )
    .map((pairing) =>
      buildPairingRow({
        state: "offline",
        pairing,
        inventory: inventoryByNodeId[pairing.node.node_id],
        deviceId,
      }),
    )
    .toSorted((a, b) => {
      const lastSeenDelta = parseTimestamp(b.lastSeenAt) - parseTimestamp(a.lastSeenAt);
      if (lastSeenDelta !== 0) return lastSeenDelta;
      return compareNodeIds(a.nodeId, b.nodeId);
    });

  return [...pendingRows, ...sortedConnectedRows, ...offlineRows];
}

type StateFilter = "all" | NodeListState;

function matchesSearch(row: NodeListRow, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    row.nodeId.toLowerCase().includes(needle) ||
    row.shortIdentifier.toLowerCase().includes(needle) ||
    (row.mode?.toLowerCase().includes(needle) ?? false)
  );
}

function getStateSortRank(state: NodeListState): number {
  switch (state) {
    case "pending":
      return 0;
    case "connected":
      return 1;
    case "offline":
      return 2;
  }
}

const NODE_COLUMNS: DataTableColumn<NodeListRow>[] = [
  {
    id: "identifier",
    header: "Identifier",
    cell: (row) => (
      <div
        className="truncate font-mono text-sm text-fg"
        title={row.nodeId}
        data-testid={`pairing-row-identifier-${row.nodeId}`}
      >
        {row.shortIdentifier}
      </div>
    ),
    sortValue: (row) => row.nodeId,
  },
  {
    id: "mode",
    header: "Mode",
    cell: (row) => <span className="truncate text-sm text-fg-muted">{row.mode ?? "-"}</span>,
    sortValue: (row) => row.mode,
  },
  {
    id: "toolCount",
    header: "#tools",
    cell: (row) => (
      <span
        className="text-sm tabular-nums text-fg-muted"
        data-testid={`pairing-row-tools-${row.nodeId}`}
      >
        {row.toolCount}
      </span>
    ),
    sortValue: (row) => row.toolCount,
  },
  {
    id: "lastSeenAt",
    header: "Last seen",
    cell: (row) => (
      <span className="truncate text-sm text-fg-muted">
        {row.lastSeenAt ? formatRelativeTime(row.lastSeenAt) : "-"}
      </span>
    ),
    sortValue: (row) => (row.lastSeenAt ? Date.parse(row.lastSeenAt) || null : null),
  },
  {
    id: "state",
    header: "State",
    cell: (row) => {
      const display = getStateDisplay(row.state);
      return <Badge variant={display.variant}>{display.label}</Badge>;
    },
    sortValue: (row) => getStateSortRank(row.state),
  },
];

export function PairingPage({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const pairing = useOperatorStore(core.pairingStore);
  const chat = useOperatorStore(core.chatStore);
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");

  const inventory = useNodeInventory({
    core,
    connected:
      connection.status === "connected" ||
      (connection.status === "connecting" && connection.recovering),
    activeSession: chat.active.session,
    refreshAt: pairing.lastSyncedAt,
  });

  const rows = useMemo(
    () =>
      buildNodeRows({
        pairingById: pairing.byId,
        inventoryNodes: inventory.nodes,
        inventoryByNodeId: inventory.byNodeId,
        deviceId: core.deviceId ?? null,
      }),
    [pairing.byId, inventory.nodes, inventory.byNodeId, core.deviceId],
  );
  const counts = useMemo(() => countRowsByState(rows), [rows]);

  const visibleRows = useMemo(() => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery && stateFilter === "all") return rows;
    return rows.filter((row) => {
      if (stateFilter !== "all" && row.state !== stateFilter) return false;
      if (!matchesSearch(row, trimmedQuery)) return false;
      return true;
    });
  }, [rows, searchQuery, stateFilter]);

  const isFiltering = searchQuery.trim() !== "" || stateFilter !== "all";

  useEffect(() => {
    if (!expandedRowKey) return;
    if (!visibleRows.some((row) => row.key === expandedRowKey)) {
      setExpandedRowKey(null);
    }
  }, [visibleRows, expandedRowKey]);

  return (
    <AppPage contentClassName="max-w-5xl gap-5">
      {inventory.error ? (
        <Alert variant="error" title="Live node status unavailable" description={inventory.error} />
      ) : null}

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading level="page" as="h2">
            Nodes
          </SectionHeading>
          <div className="text-sm text-fg-muted">
            {isFiltering
              ? `Showing ${String(visibleRows.length)} of ${String(rows.length)} — `
              : null}
            {counts.pending} pending, {counts.connected} connected, {counts.offline} offline
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Input
            data-testid="pairing-search"
            value={searchQuery}
            placeholder="Filter by identifier or mode"
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
          <Select
            bare
            aria-label="Filter by state"
            data-testid="pairing-state-filter"
            value={stateFilter}
            onChange={(event) => setStateFilter(event.currentTarget.value as StateFilter)}
          >
            <option value="all">All states</option>
            <option value="pending">Pending</option>
            <option value="connected">Connected</option>
            <option value="offline">Offline</option>
          </Select>
        </div>

        {inventory.loading && rows.length === 0 ? (
          <Card>
            <div className="px-6 py-5">
              <LoadingState label="Loading nodes..." />
            </div>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <EmptyState
              data-testid="pairing-empty-state"
              icon={Link2}
              title="No nodes"
              description="Nodes will appear here when devices connect or request access."
            />
          </Card>
        ) : visibleRows.length === 0 ? (
          <Card>
            <EmptyState
              data-testid="pairing-empty-filtered"
              icon={Link2}
              title="No matching nodes"
              description="Try adjusting your search or filter criteria."
            />
          </Card>
        ) : (
          <DataTable<NodeListRow>
            data-testid="pairing-list"
            columns={NODE_COLUMNS}
            data={visibleRows}
            rowKey={(row) => row.key}
            rowClassName={(row) => (row.attachmentKind === "local" ? "bg-primary/5" : "")}
            testIdPrefix="pairing-row"
            sortable
            striped
            expandedRowKey={expandedRowKey}
            onExpandedRowChange={setExpandedRowKey}
            renderExpandedRow={(row) => <ExpandedRowDetails core={core} row={row} />}
          />
        )}
      </div>
    </AppPage>
  );
}
