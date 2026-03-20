import type {
  AgentListItem,
  MemoryItem,
  MemoryItemKind,
  MemorySearchHit,
  MemorySensitivity,
  MemoryTombstone,
} from "@tyrum/contracts";
import { Brain, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { OperatorCore } from "@tyrum/operator-app";
import { useApiAction } from "../../hooks/use-api-action.js";
import { useReconnectScrollArea, useReconnectTabState } from "../../reconnect-ui-state.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { DataTable } from "../ui/data-table.js";
import { EmptyState } from "../ui/empty-state.js";
import { Spinner } from "../ui/spinner.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import {
  useAdminHttpClient,
  useAdminMutationAccess,
  useAdminMutationHttpClient,
} from "./admin-http-shared.js";
import type { MemoryTab } from "./memory-page.lib.js";
import {
  buildItemColumns,
  buildTombstoneColumns,
  MemoryFilterBar,
  MemoryItemExpandedDetail,
} from "./memory-page.sections.js";

type SearchItemCache = Record<string, MemoryItem | null>;

export function MemoryPage({ core }: { core: OperatorCore }) {
  const [tab, setTab] = useReconnectTabState<MemoryTab>("memory.tab", "items");
  const scrollAreaRef = useReconnectScrollArea("memory:page");

  const readClient = useAdminHttpClient();
  const mutationClient = useAdminMutationHttpClient();
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const deleteAction = useApiAction<MemoryTombstone>();

  // Data state
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [tombstones, setTombstones] = useState<MemoryTombstone[]>([]);
  const [itemsCursor, setItemsCursor] = useState<string | undefined>();
  const [tombstonesCursor, setTombstonesCursor] = useState<string | undefined>();
  const [agents, setAgents] = useState<AgentListItem[]>([]);

  // Loading state
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Filter state
  const [agentId, setAgentId] = useState<string | undefined>();
  const [kinds, setKinds] = useState<MemoryItemKind[]>([]);
  const [sensitivity, setSensitivity] = useState<MemorySensitivity | undefined>();
  const [searchQuery, setSearchQuery] = useState("");

  // Search state
  const [searchHits, setSearchHits] = useState<MemorySearchHit[]>([]);
  const [searchItemCache, setSearchItemCache] = useState<SearchItemCache>({});

  // Expand / delete state
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemoryItem | null>(null);

  const searchMode = searchQuery.trim().length > 0;

  const agentLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) {
      if (a.agent_id) map.set(a.agent_id, a.agent_key);
    }
    return map;
  }, [agents]);

  // Load agents once
  useEffect(() => {
    void readClient.agentList?.get({ include_default: true }).then((r) => {
      setAgents(r.agents);
    });
  }, [readClient.agentList]);

  // Load data on filter change
  useEffect(() => {
    let cancelled = false;
    const sensitivities = sensitivity ? [sensitivity] : undefined;

    const load = async () => {
      setLoading(true);
      setError(null);
      setExpandedItemId(null);

      try {
        if (searchMode) {
          const result = await readClient.memory?.search({
            agent_id: agentId,
            query: searchQuery.trim(),
            kinds: kinds.length > 0 ? kinds : undefined,
            sensitivities,
          });
          if (!cancelled && result) {
            setSearchHits(result.hits);
            setSearchItemCache({});
          }
        } else {
          const [itemsResult, tombstonesResult] = await Promise.all([
            readClient.memory?.list({
              agent_id: agentId,
              kinds: kinds.length > 0 ? kinds : undefined,
              sensitivities,
            }),
            readClient.memory?.listTombstones({ agent_id: agentId }),
          ]);
          if (!cancelled) {
            setItems(itemsResult?.items ?? []);
            setItemsCursor(itemsResult?.next_cursor);
            setTombstones(tombstonesResult?.tombstones ?? []);
            setTombstonesCursor(tombstonesResult?.next_cursor);
            setSearchHits([]);
            setSearchItemCache({});
          }
        }
      } catch (err) {
        if (!cancelled) setError(formatErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [readClient, agentId, kinds, sensitivity, searchQuery, searchMode, refreshNonce]);

  const loadMoreItems = useCallback(async () => {
    if (!itemsCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const sensitivities = sensitivity ? [sensitivity] : undefined;
      const result = await readClient.memory?.list({
        agent_id: agentId,
        kinds: kinds.length > 0 ? kinds : undefined,
        sensitivities,
        cursor: itemsCursor,
      });
      if (result) {
        setItems((prev) => [...prev, ...result.items]);
        setItemsCursor(result.next_cursor);
      }
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [readClient, agentId, kinds, sensitivity, itemsCursor, loadingMore]);

  const loadMoreTombstones = useCallback(async () => {
    if (!tombstonesCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await readClient.memory?.listTombstones({
        agent_id: agentId,
        cursor: tombstonesCursor,
      });
      if (result) {
        setTombstones((prev) => [...prev, ...result.tombstones]);
        setTombstonesCursor(result.next_cursor);
      }
    } catch (err) {
      setError(formatErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [readClient, agentId, tombstonesCursor, loadingMore]);

  function handleExpandItem(key: string | null) {
    setExpandedItemId(key);
    if (!searchMode || !key || key in searchItemCache) return;

    const memoryClient = readClient.memory;
    if (!memoryClient) return;

    // Cache misses and failures so a broken item fetch is not retried on every render.
    void memoryClient
      .getById(key)
      .then((response) => {
        setSearchItemCache((prev) => ({ ...prev, [key]: response.item }));
      })
      .catch(() => {
        setSearchItemCache((prev) => (key in prev ? prev : { ...prev, [key]: null }));
      });
  }

  function handleDelete(item: MemoryItem) {
    if (!canMutate) {
      requestEnter();
      return;
    }
    setDeleteTarget(item);
  }

  async function confirmDelete() {
    if (!deleteTarget || !mutationClient?.memory) return;
    const tombstone = await deleteAction.runAndThrow(async () => {
      const result = await mutationClient.memory!.delete(deleteTarget.memory_item_id, {
        reason: "Operator deletion via UI",
      });
      return result.tombstone;
    });
    setItems((prev) => prev.filter((i) => i.memory_item_id !== deleteTarget.memory_item_id));
    if (tombstone) {
      setTombstones((prev) => [tombstone, ...prev]);
    }
    setDeleteTarget(null);
  }

  // Build items to show in the table when in search mode
  const searchDisplayItems: MemoryItem[] = useMemo(() => {
    return searchHits
      .map((hit) => searchItemCache[hit.memory_item_id])
      .filter((item): item is MemoryItem => item !== undefined && item !== null);
  }, [searchHits, searchItemCache]);

  const pendingSearchItemCount = useMemo(
    () => searchHits.filter((hit) => !(hit.memory_item_id in searchItemCache)).length,
    [searchHits, searchItemCache],
  );

  // Fetch full items for all search hits for the table
  useEffect(() => {
    const memoryClient = readClient.memory;
    if (!searchMode || searchHits.length === 0 || !memoryClient) return;
    let cancelled = false;

    const fetchMissing = async () => {
      const missingIds = searchHits
        .map((h) => h.memory_item_id)
        .filter((id) => !(id in searchItemCache));
      if (missingIds.length === 0) return;

      const results = await Promise.all(
        missingIds.map((id) =>
          memoryClient
            .getById(id)
            .then((r) => r.item)
            .catch(() => null),
        ),
      );

      if (cancelled) return;
      setSearchItemCache((prev) => {
        const nextEntries: SearchItemCache = {};
        let hasUpdates = false;

        for (const [index, id] of missingIds.entries()) {
          if (id in prev) continue;
          nextEntries[id] = results[index] ?? null;
          hasUpdates = true;
        }

        return hasUpdates ? { ...prev, ...nextEntries } : prev;
      });
    };

    void fetchMissing();
    return () => {
      cancelled = true;
    };
  }, [searchMode, searchHits, readClient, searchItemCache]);

  const displayItems = searchMode ? searchDisplayItems : items;

  const itemColumns = useMemo(
    () => buildItemColumns({ agentLookup, canMutate, onDelete: handleDelete }),
    [agentLookup, canMutate],
  );

  const tombstoneColumns = useMemo(() => buildTombstoneColumns(agentLookup), [agentLookup]);

  return (
    <AppPage
      contentClassName="max-w-5xl gap-4"
      data-testid="memory-page"
      scrollAreaRef={scrollAreaRef}
    >
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 text-base font-semibold text-fg">
            <Brain className="h-4 w-4" />
            Agent Memory
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="text-sm text-fg-muted">
            Browse, search, and manage memory items that agents have accumulated during operation.
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{`${items.length} items`}</Badge>
            <Badge variant="outline">{`${tombstones.length} deleted`}</Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              isLoading={loading}
              onClick={() => {
                setRefreshNonce((n) => n + 1);
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
          {error ? (
            <Alert
              variant="error"
              title="Failed to load memory"
              description={error}
              onDismiss={() => {
                setError(null);
              }}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <MemoryFilterBar
            agents={agents}
            agentId={agentId}
            onAgentChange={setAgentId}
            kinds={kinds}
            onKindsChange={setKinds}
            sensitivity={sensitivity}
            onSensitivityChange={setSensitivity}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        </CardContent>
      </Card>

      {searchMode && pendingSearchItemCount > 0 ? (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner className="h-4 w-4" />
          Loading search results…
        </div>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as MemoryTab);
        }}
        className="grid gap-3"
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="items">
            Items{displayItems.length > 0 ? ` (${displayItems.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="tombstones">
            Deleted{tombstones.length > 0 ? ` (${tombstones.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="items" className="grid gap-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-6 w-6" />
            </div>
          ) : displayItems.length === 0 ? (
            <EmptyState
              icon={Brain}
              title={searchMode ? "No matches" : "No memory items"}
              description={
                searchMode
                  ? "No memory items matched your search query."
                  : "Agents haven't stored any memory items yet."
              }
            />
          ) : (
            <>
              <DataTable
                columns={itemColumns}
                data={displayItems}
                rowKey={(row) => row.memory_item_id}
                sortable
                renderExpandedRow={(row) => (
                  <MemoryItemExpandedDetail item={row} agentLabel={agentLookup.get(row.agent_id)} />
                )}
                expandedRowKey={expandedItemId}
                onExpandedRowChange={handleExpandItem}
              />
              {!searchMode && itemsCursor ? (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingMore}
                    isLoading={loadingMore}
                    onClick={() => {
                      void loadMoreItems();
                    }}
                  >
                    Load more
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </TabsContent>

        <TabsContent value="tombstones" className="grid gap-3">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-6 w-6" />
            </div>
          ) : tombstones.length === 0 ? (
            <EmptyState
              icon={Brain}
              title="No deleted items"
              description="No memory items have been deleted yet."
            />
          ) : (
            <>
              <DataTable
                columns={tombstoneColumns}
                data={tombstones}
                rowKey={(row) => row.memory_item_id}
                sortable
              />
              {tombstonesCursor ? (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loadingMore}
                    isLoading={loadingMore}
                    onClick={() => {
                      void loadMoreTombstones();
                    }}
                  >
                    Load more
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </TabsContent>
      </Tabs>

      {deleteAction.state.status === "error" ? (
        <Alert
          variant="error"
          title="Failed to delete memory item"
          description={formatErrorMessage(deleteAction.state.error)}
          onDismiss={() => {
            deleteAction.reset();
          }}
        />
      ) : null}

      <ConfirmDangerDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete memory item"
        description="This will permanently remove this memory item and create a tombstone record."
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        isLoading={deleteAction.isLoading}
      />
    </AppPage>
  );
}
