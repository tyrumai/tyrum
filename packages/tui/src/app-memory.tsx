import type { MemoryItem, OperatorCore } from "@tyrum/operator-core";
import { Box, Text } from "ink";
import { useEffect, useMemo, useRef } from "react";
import { getEffectiveCursor } from "./tui-input.js";
import { getMemoryBrowseIds, maskToken, truncateText, useOperatorStore } from "./app-support.js";

function formatMemoryItemSummary(item: MemoryItem): string {
  switch (item.kind) {
    case "fact": {
      const value =
        item.value === null || item.value === undefined
          ? String(item.value)
          : typeof item.value === "string"
            ? item.value
            : JSON.stringify(item.value);
      return truncateText(`${item.key}=${value}`, 60);
    }
    case "note": {
      const title = item.title ? `${item.title}: ` : "";
      return truncateText(`${title}${item.body_md}`, 60);
    }
    case "procedure": {
      const title = item.title ? `${item.title}: ` : "";
      return truncateText(`${title}${item.body_md}`, 60);
    }
    case "episode":
      return truncateText(item.summary_md, 60);
  }

  return "";
}

function MemoryItemDetails({ item }: { item: MemoryItem }) {
  return (
    <>
      <Text dimColor>
        kind={item.kind} agent={item.agent_id} sensitivity={item.sensitivity}
      </Text>
      {item.tags.length > 0 ? <Text dimColor>tags: {item.tags.join(", ")}</Text> : null}
      <Text dimColor>
        created: {item.created_at}
        {item.updated_at ? ` updated: ${item.updated_at}` : ""}
      </Text>
      <Text dimColor>provenance: {item.provenance.source_kind}</Text>
      <Box flexDirection="column" paddingTop={1}>
        {item.kind === "fact" ? (
          <>
            <Text>
              <Text bold>{item.key}</Text>
            </Text>
            <Text dimColor>confidence: {String(item.confidence)}</Text>
            <Text dimColor>observed_at: {item.observed_at}</Text>
            <Text>{truncateText(JSON.stringify(item.value), 120)}</Text>
          </>
        ) : null}
        {item.kind === "note" ? <Text>{item.body_md}</Text> : null}
        {item.kind === "procedure" ? <Text>{item.body_md}</Text> : null}
        {item.kind === "episode" ? (
          <>
            <Text dimColor>occurred_at: {item.occurred_at}</Text>
            <Text>{item.summary_md}</Text>
          </>
        ) : null}
      </Box>
    </>
  );
}

export function MemoryScreen(props: {
  core: OperatorCore;
  cursor: number;
  selectedId: string | null;
}) {
  const connection = useOperatorStore(props.core.connectionStore);
  const memory = useOperatorStore(props.core.memoryStore);
  const initialListStoreRef = useRef<OperatorCore["memoryStore"] | null>(null);
  const browseResults = memory.browse.results;
  const ids = useMemo(() => getMemoryBrowseIds(memory), [memory]);
  const effectiveCursor = getEffectiveCursor({
    ids,
    cursor: props.cursor,
    selectedId: props.selectedId,
  });
  const selectedIdFromCursor = ids[effectiveCursor];
  const selectedHit =
    browseResults?.kind === "search" && typeof selectedIdFromCursor === "string"
      ? (browseResults.hits.find((hit) => hit.memory_item_id === selectedIdFromCursor) ?? null)
      : null;
  const selectedFromList =
    browseResults?.kind === "list" && typeof selectedIdFromCursor === "string"
      ? (browseResults.items.find((item) => item.memory_item_id === selectedIdFromCursor) ?? null)
      : null;
  const selectedInspect =
    typeof selectedIdFromCursor === "string" && memory.inspect.memoryItemId === selectedIdFromCursor
      ? memory.inspect.item
      : null;
  const selectedInspectError =
    typeof selectedIdFromCursor === "string" && memory.inspect.memoryItemId === selectedIdFromCursor
      ? memory.inspect.error
      : null;
  const selectedInspectLoading =
    typeof selectedIdFromCursor === "string" && memory.inspect.memoryItemId === selectedIdFromCursor
      ? memory.inspect.loading
      : false;

  useEffect(() => {
    if (connection.status !== "connected") return;
    if (!selectedIdFromCursor || !browseResults || browseResults.kind !== "search") return;
    if (memory.inspect.memoryItemId === selectedIdFromCursor) return;
    void props.core.memoryStore.inspect(selectedIdFromCursor).catch(() => {});
  }, [
    browseResults,
    connection.status,
    memory.inspect.memoryItemId,
    props.core.memoryStore,
    selectedIdFromCursor,
  ]);

  useEffect(() => {
    if (connection.status !== "connected") return;
    if (initialListStoreRef.current === props.core.memoryStore) return;
    initialListStoreRef.current = props.core.memoryStore;
    void props.core.memoryStore.list().catch(() => {});
  }, [connection.status, props.core.memoryStore]);

  const headerLabel =
    memory.browse.request?.kind === "search" ? `Search: ${memory.browse.request.query}` : "List";
  const browseErrorLabel = memory.browse.error ? memory.browse.error.message : null;
  const forgetErrorLabel = memory.tombstones.error ? memory.tombstones.error.message : null;

  return (
    <Box flexDirection="column">
      <Text dimColor>Keys: ↑/↓ select /=search r=refresh f=forget p=export</Text>
      <Text>
        Mode: <Text bold>{headerLabel}</Text>
        {memory.browse.loading ? <Text dimColor> (loading)</Text> : null}
      </Text>
      {browseErrorLabel ? <Text color="red">Error: {browseErrorLabel}</Text> : null}
      {forgetErrorLabel ? <Text color="red">Forget error: {forgetErrorLabel}</Text> : null}
      {memory.export.error ? (
        <Text color="red">Export error: {memory.export.error.message}</Text>
      ) : null}
      {memory.export.artifactId ? (
        <Text>
          Last export artifact: <Text bold>{memory.export.artifactId}</Text>
        </Text>
      ) : null}

      <Box flexDirection="column" paddingTop={1}>
        {ids.length === 0 ? (
          <Text dimColor>No memory items.</Text>
        ) : browseResults?.kind === "list" ? (
          browseResults.items.map((item, index) => {
            const id = item.memory_item_id;
            const isSelected = index === effectiveCursor;
            const label = `${id.slice(0, 8)} [${item.kind}] ${formatMemoryItemSummary(item)}`;
            return (
              <Text key={id} inverse={isSelected}>
                {isSelected ? "> " : "  "}
                {truncateText(label.trim(), 78)}
              </Text>
            );
          })
        ) : browseResults?.kind === "search" ? (
          browseResults.hits.map((hit, index) => {
            const id = hit.memory_item_id;
            const isSelected = index === effectiveCursor;
            const score = ` score=${hit.score.toFixed(2)}`;
            const label = `${id.slice(0, 8)} [${hit.kind}]${score} ${hit.snippet ?? ""}`;
            return (
              <Text key={id} inverse={isSelected}>
                {isSelected ? "> " : "  "}
                {truncateText(label.trim(), 78)}
              </Text>
            );
          })
        ) : null}
      </Box>

      {selectedIdFromCursor ? (
        <Box flexDirection="column" paddingTop={1}>
          <Text bold>Selected</Text>
          <Text>{selectedIdFromCursor}</Text>
          {selectedInspectError ? (
            <Text color="red">Error loading item: {selectedInspectError.message}</Text>
          ) : selectedInspect ? (
            <MemoryItemDetails item={selectedInspect} />
          ) : selectedFromList ? (
            <MemoryItemDetails item={selectedFromList} />
          ) : selectedInspectLoading ? (
            <Text dimColor>Loading item details…</Text>
          ) : selectedHit ? (
            <Text dimColor>Loading item details…</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

export function ElevatedModeDialog(props: { token: string; busy: boolean; error: string | null }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      padding={1}
      marginBottom={1}
    >
      <Text bold>Enter Elevated Mode</Text>
      <Text dimColor>Paste elevated access token and press Enter. Esc cancels.</Text>
      <Text>
        Access token: <Text color="yellow">{maskToken(props.token)}</Text>
      </Text>
      {props.busy ? <Text dimColor>Entering...</Text> : null}
      {props.error ? <Text color="red">Error: {props.error}</Text> : null}
    </Box>
  );
}

export function MemorySearchDialog(props: { query: string; busy: boolean; error: string | null }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1} marginBottom={1}>
      <Text bold>Search memory</Text>
      <Text dimColor>Type a query and press Enter. Esc cancels.</Text>
      <Text>
        Query: <Text color="cyan">{props.query}</Text>
      </Text>
      {props.busy ? <Text dimColor>Searching...</Text> : null}
      {props.error ? <Text color="red">Error: {props.error}</Text> : null}
    </Box>
  );
}

export function MemoryForgetDialog(props: {
  memoryItemId: string;
  confirmText: string;
  busy: boolean;
  error: string | null;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1} marginBottom={1}>
      <Text bold>Forget memory item</Text>
      <Text dimColor>Type FORGET and press Enter. Esc cancels.</Text>
      <Text>
        ID: <Text bold>{props.memoryItemId}</Text>
      </Text>
      <Text>
        Confirm: <Text color="red">{props.confirmText}</Text>
      </Text>
      {props.busy ? <Text dimColor>Forgetting...</Text> : null}
      {props.error ? <Text color="red">Error: {props.error}</Text> : null}
    </Box>
  );
}
