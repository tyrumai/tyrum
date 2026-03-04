import {
  formatElevatedModeRemaining,
  isElevatedModeActive,
  type ElevatedModeState,
  type OperatorCore,
  type OperatorCoreManager,
} from "@tyrum/operator-core";
import type { MemoryItem } from "@tyrum/operator-core";
import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ResolvedTuiConfig } from "./config.js";
import type { TuiRuntime } from "./core.js";
import {
  createInitialTuiUiState,
  getEffectiveCursor,
  reduceTuiInput,
  type TuiCommand,
  type TuiKey,
} from "./tui-input.js";
import { getAttemptsForStep, getRunList, getStepsForRun } from "./runs-view.js";

const MAX_RUNS_VISIBLE = 20;

function useOperatorStore<T>(store: {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
}): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

function useOperatorCoreManager(manager: OperatorCoreManager): OperatorCore {
  return useSyncExternalStore(
    (listener) => manager.subscribe(listener),
    () => manager.getCore(),
    () => manager.getCore(),
  );
}

function toTuiKey(key: unknown): TuiKey {
  if (!key || typeof key !== "object" || Array.isArray(key)) return {};
  const rec = key as Record<string, unknown>;
  return {
    ctrl: rec["ctrl"] === true,
    upArrow: rec["upArrow"] === true,
    downArrow: rec["downArrow"] === true,
  };
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function AppHeader({ title, elevatedMode }: { title: string; elevatedMode: ElevatedModeState }) {
  const elevatedModeActive = isElevatedModeActive(elevatedMode);
  return (
    <Box flexDirection="column" paddingBottom={1}>
      <Text bold>{title}</Text>
      <Text dimColor>
        Keys: c=connect d=disconnect 1=connect 2=status 3=approvals 4=runs 5=pairing 6=memory
        m=elevated q=quit
      </Text>
      {elevatedModeActive ? (
        <Text color="yellow">
          Elevated Mode active · {formatElevatedModeRemaining(elevatedMode)} remaining (e=exit)
        </Text>
      ) : null}
    </Box>
  );
}

function ConnectScreen({
  core,
  config,
}: {
  core: OperatorCore;
  config: Pick<ResolvedTuiConfig, "httpBaseUrl" | "wsUrl" | "deviceIdentityPath">;
}) {
  const connection = useOperatorStore(core.connectionStore);

  return (
    <Box flexDirection="column">
      <Text>
        Gateway: <Text bold>{config.httpBaseUrl}</Text>
      </Text>
      <Text>
        WS: <Text bold>{config.wsUrl}</Text>
      </Text>
      <Text>
        Device identity: <Text bold>{config.deviceIdentityPath}</Text>
      </Text>

      <Box flexDirection="column" paddingTop={1}>
        <Text>
          Status: <Text bold>{connection.status}</Text>
        </Text>
        {connection.clientId ? (
          <Text>
            Client ID: <Text bold>{connection.clientId}</Text>
          </Text>
        ) : null}
        {connection.transportError ? (
          <Text color="red">Transport error: {connection.transportError}</Text>
        ) : null}
        {connection.lastDisconnect ? (
          <Text color="red">
            Last disconnect: {String(connection.lastDisconnect.code)}{" "}
            {connection.lastDisconnect.reason}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

function StatusScreen({ core }: { core: OperatorCore }) {
  const connection = useOperatorStore(core.connectionStore);
  const approvals = useOperatorStore(core.approvalsStore);
  const pairing = useOperatorStore(core.pairingStore);
  const status = useOperatorStore(core.statusStore);

  const pendingApprovals = approvals.pendingIds.length;
  const pendingPairings = pairing.pendingIds.length;
  const presenceCount = useMemo(
    () => Object.keys(status.presenceByInstanceId).length,
    [status.presenceByInstanceId],
  );

  return (
    <Box flexDirection="column">
      <Text>
        Connection: <Text bold>{connection.status}</Text>
      </Text>
      <Text>Pending approvals: {String(pendingApprovals)}</Text>
      <Text>Pending pairings: {String(pendingPairings)}</Text>
      <Text>Presence entries: {String(presenceCount)}</Text>
    </Box>
  );
}

function ApprovalsScreen({
  core,
  cursor,
  selectedId,
}: {
  core: OperatorCore;
  cursor: number;
  selectedId: string | null;
}) {
  const approvals = useOperatorStore(core.approvalsStore);
  const pendingIds = approvals.pendingIds;
  const effectiveCursor = getEffectiveCursor({ ids: pendingIds, cursor, selectedId });

  const selectedIdFromCursor = pendingIds[effectiveCursor];
  const selected =
    typeof selectedIdFromCursor === "string" ? approvals.byId[selectedIdFromCursor] : null;

  return (
    <Box flexDirection="column">
      <Text dimColor>Keys: ↑/↓ select a=approve x=deny r=refresh</Text>
      <Text>
        Pending: <Text bold>{String(pendingIds.length)}</Text>
        {approvals.loading ? <Text dimColor> (loading)</Text> : null}
      </Text>
      {approvals.error ? <Text color="red">Error: {approvals.error}</Text> : null}

      <Box flexDirection="column" paddingTop={1}>
        {pendingIds.length === 0 ? (
          <Text dimColor>No pending approvals.</Text>
        ) : (
          pendingIds.map((approvalId, index) => {
            const approval = approvals.byId[approvalId];
            const label = approval
              ? `${String(approvalId)} [${approval.kind}] ${truncateText(approval.prompt, 72)}`
              : String(approvalId);
            const isSelected = index === effectiveCursor;
            return (
              <Text key={approvalId} inverse={isSelected}>
                {isSelected ? "> " : "  "}
                {label}
              </Text>
            );
          })
        )}
      </Box>

      {selected ? (
        <Box flexDirection="column" paddingTop={1}>
          <Text bold>Selected</Text>
          <Text>
            #{String(selected.approval_id)} ({selected.status}) kind={selected.kind}
          </Text>
          <Text>{selected.prompt}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

function getPairingIds(pairing: ReturnType<OperatorCore["pairingStore"]["getSnapshot"]>): number[] {
  const ids = Object.keys(pairing.byId)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
  const pending = new Set(pairing.pendingIds);
  ids.sort((a, b) => {
    const aPending = pending.has(a);
    const bPending = pending.has(b);
    if (aPending !== bPending) return aPending ? -1 : 1;
    return a - b;
  });
  return ids;
}

function PairingScreen({
  core,
  cursor,
  selectedId,
}: {
  core: OperatorCore;
  cursor: number;
  selectedId: number | null;
}) {
  const pairing = useOperatorStore(core.pairingStore);
  const pairingIds = useMemo(() => getPairingIds(pairing), [pairing]);
  const effectiveCursor = getEffectiveCursor({ ids: pairingIds, cursor, selectedId });
  const selectedIdFromCursor = pairingIds[effectiveCursor];
  const selected =
    typeof selectedIdFromCursor === "number" ? pairing.byId[selectedIdFromCursor] : null;

  const pendingCount = pairing.pendingIds.length;
  const totalCount = pairingIds.length;

  return (
    <Box flexDirection="column">
      <Text dimColor>Keys: ↑/↓ select a=approve x=deny v=revoke r=refresh</Text>
      <Text>
        Pending: <Text bold>{String(pendingCount)}</Text> Total: {String(totalCount)}
        {pairing.loading ? <Text dimColor> (loading)</Text> : null}
      </Text>
      {pairing.error ? <Text color="red">Error: {pairing.error}</Text> : null}

      <Box flexDirection="column" paddingTop={1}>
        {pairingIds.length === 0 ? (
          <Text dimColor>No pairing requests.</Text>
        ) : (
          pairingIds.map((pairingId, index) => {
            const req = pairing.byId[pairingId];
            const label = req
              ? `${String(pairingId)} [${req.status}] ${req.node.node_id}`
              : String(pairingId);
            const isSelected = index === effectiveCursor;
            return (
              <Text key={pairingId} inverse={isSelected}>
                {isSelected ? "> " : "  "}
                {label}
              </Text>
            );
          })
        )}
      </Box>

      {selected ? (
        <Box flexDirection="column" paddingTop={1}>
          <Text bold>Selected</Text>
          <Text>
            #{String(selected.pairing_id)} ({selected.status})
            {selected.trust_level ? ` trust=${selected.trust_level}` : ""}
          </Text>
          {selected.node.label ? <Text>Label: {selected.node.label}</Text> : null}
          <Text dimColor>
            Capabilities: {String(selected.node.capabilities.length)} Allowlist:{" "}
            {String(selected.capability_allowlist.length)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function RunsScreen({
  core,
  cursor,
  selectedId,
}: {
  core: OperatorCore;
  cursor: number;
  selectedId: string | null;
}) {
  const runsState = useOperatorStore(core.runsStore);
  const runs = useMemo(() => getRunList(runsState).slice(0, MAX_RUNS_VISIBLE), [runsState]);
  const runIds = useMemo(() => runs.map((run) => run.run_id), [runs]);
  const effectiveCursor = getEffectiveCursor({ ids: runIds, cursor, selectedId });
  const selectedRun = runs[effectiveCursor] ?? null;
  const steps = selectedRun ? getStepsForRun(runsState, selectedRun.run_id) : [];

  return (
    <Box flexDirection="column">
      <Text dimColor>Keys: ↑/↓ select (runs/steps update via WS events)</Text>
      <Text>
        Runs: <Text bold>{String(Object.keys(runsState.runsById).length)}</Text> (showing{" "}
        {String(runs.length)})
      </Text>
      {runs.length === 0 ? (
        <Text dimColor>No runs yet.</Text>
      ) : (
        <Box flexDirection="column" paddingTop={1}>
          {runs.map((run, index) => {
            const isSelected = index === effectiveCursor;
            const label = `${run.status} ${run.key}:${run.lane} ${run.run_id.slice(0, 8)}`;
            return (
              <Text key={run.run_id} inverse={isSelected}>
                {isSelected ? "> " : "  "}
                {label}
              </Text>
            );
          })}
        </Box>
      )}

      {selectedRun ? (
        <Box flexDirection="column" paddingTop={1}>
          <Text bold>Selected run</Text>
          <Text>{selectedRun.run_id}</Text>
          <Text>
            Status: <Text bold>{selectedRun.status}</Text> attempt {String(selectedRun.attempt)}
          </Text>
          {selectedRun.paused_reason ? (
            <Text color="yellow">
              Paused: {selectedRun.paused_reason}
              {selectedRun.paused_detail ? ` — ${truncateText(selectedRun.paused_detail, 80)}` : ""}
            </Text>
          ) : null}
          <Text dimColor>
            Created: {selectedRun.created_at}
            {selectedRun.started_at ? ` Started: ${selectedRun.started_at}` : ""}
            {selectedRun.finished_at ? ` Finished: ${selectedRun.finished_at}` : ""}
          </Text>

          <Box flexDirection="column" paddingTop={1}>
            <Text bold>Steps</Text>
            {steps.length === 0 ? (
              <Text dimColor>No steps yet.</Text>
            ) : (
              steps.map((step) => {
                const attempts = getAttemptsForStep(runsState, step.step_id);
                return (
                  <Box key={step.step_id} flexDirection="column" paddingLeft={2} paddingTop={1}>
                    <Text>
                      Step {String(step.step_index)}: {step.action.type} ({step.status})
                    </Text>
                    {attempts.length === 0 ? (
                      <Text dimColor> No attempts yet.</Text>
                    ) : (
                      attempts.map((attempt) => (
                        <Text key={attempt.attempt_id} dimColor>
                          {"  "}Attempt {String(attempt.attempt)}: {attempt.status}
                          {attempt.error ? ` — ${truncateText(attempt.error, 80)}` : ""}
                        </Text>
                      ))
                    )}
                  </Box>
                );
              })
            )}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function maskToken(token: string): string {
  if (!token) return "";
  const max = 24;
  if (token.length <= max) return "•".repeat(token.length);
  return `${"•".repeat(max)}…`;
}

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
    case "episode": {
      return truncateText(item.summary_md, 60);
    }
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
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

function MemoryScreen({
  core,
  cursor,
  selectedId,
}: {
  core: OperatorCore;
  cursor: number;
  selectedId: string | null;
}) {
  const connection = useOperatorStore(core.connectionStore);
  const memory = useOperatorStore(core.memoryStore);
  const initialListStoreRef = useRef<OperatorCore["memoryStore"] | null>(null);
  const browseResults = memory.browse.results;
  const ids = useMemo((): string[] => {
    if (!browseResults) return [];
    if (browseResults.kind === "list") {
      return browseResults.items.map((item) => item.memory_item_id);
    }
    return browseResults.hits.map((hit) => hit.memory_item_id);
  }, [browseResults]);
  const effectiveCursor = getEffectiveCursor({ ids, cursor, selectedId });
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
    if (!selectedIdFromCursor) return;
    if (!browseResults || browseResults.kind !== "search") return;
    if (memory.inspect.memoryItemId === selectedIdFromCursor) return;
    void core.memoryStore.inspect(selectedIdFromCursor).catch(() => {});
  }, [
    browseResults,
    connection.status,
    core.memoryStore,
    memory.inspect.memoryItemId,
    selectedIdFromCursor,
  ]);

  useEffect(() => {
    if (connection.status !== "connected") return;
    if (initialListStoreRef.current === core.memoryStore) return;
    initialListStoreRef.current = core.memoryStore;
    void core.memoryStore.list().catch(() => {});
  }, [connection.status, core.memoryStore]);

  const headerLabel =
    memory.browse.request?.kind === "search" ? `Search: ${memory.browse.request.query}` : "List";
  const browseErrorLabel = memory.browse.error ? memory.browse.error.message : null;
  const forgetErrorLabel = memory.tombstones.error ? memory.tombstones.error.message : null;
  const exportArtifactId = memory.export.artifactId;

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
      {exportArtifactId ? (
        <Text>
          Last export artifact: <Text bold>{exportArtifactId}</Text>
        </Text>
      ) : null}

      <Box flexDirection="column" paddingTop={1}>
        {ids.length === 0 ? (
          <Text dimColor>No memory items.</Text>
        ) : browseResults?.kind === "list" ? (
          browseResults.items.map((item, index) => {
            const id = item.memory_item_id;
            const isSelected = index === effectiveCursor;
            const prefix = isSelected ? "> " : "  ";
            const kind = item.kind;
            const summary = formatMemoryItemSummary(item);
            const label = `${id.slice(0, 8)} [${kind}] ${summary}`.trim();
            return (
              <Text key={id} inverse={isSelected}>
                {prefix}
                {truncateText(label, 78)}
              </Text>
            );
          })
        ) : browseResults?.kind === "search" ? (
          browseResults.hits.map((hit, index) => {
            const id = hit.memory_item_id;
            const isSelected = index === effectiveCursor;
            const prefix = isSelected ? "> " : "  ";
            const kind = hit.kind;
            const summary = hit.snippet ?? "";
            const score = ` score=${hit.score.toFixed(2)}`;
            const label = `${id.slice(0, 8)} [${kind}]${score} ${summary}`.trim();
            return (
              <Text key={id} inverse={isSelected}>
                {prefix}
                {truncateText(label, 78)}
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
          ) : selectedInspectLoading ? (
            <Text dimColor>Loading item details…</Text>
          ) : selectedInspect ? (
            <MemoryItemDetails item={selectedInspect} />
          ) : selectedFromList ? (
            <MemoryItemDetails item={selectedFromList} />
          ) : selectedHit ? (
            <Text dimColor>Loading item details…</Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

function ElevatedModeDialog(props: { token: string; busy: boolean; error: string | null }) {
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

function MemorySearchDialog(props: { query: string; busy: boolean; error: string | null }) {
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

function MemoryForgetDialog(props: {
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

export function TuiApp({ runtime, config }: { runtime: TuiRuntime; config: ResolvedTuiConfig }) {
  const { exit } = useApp();
  const core = useOperatorCoreManager(runtime.manager);
  const coreRef = useRef(core);
  coreRef.current = core;
  const elevatedMode = useOperatorStore(core.elevatedModeStore);
  const [uiState, setUiState] = useState(() => createInitialTuiUiState());
  const uiStateRef = useRef(uiState);
  uiStateRef.current = uiState;

  useEffect(() => {
    runtime.manager.getCore().connect();
    return () => {
      runtime.manager.getCore().disconnect();
    };
  }, [runtime.manager]);

  const [elevatedDialog, setElevatedDialog] = useState<{
    open: boolean;
    token: string;
    busy: boolean;
    error: string | null;
  }>({ open: false, token: "", busy: false, error: null });
  const elevatedDialogRef = useRef(elevatedDialog);
  elevatedDialogRef.current = elevatedDialog;

  const openElevatedDialog = (): void => {
    setElevatedDialog({ open: true, token: "", busy: false, error: null });
  };

  const closeElevatedDialog = (): void => {
    if (elevatedDialogRef.current.busy) return;
    setElevatedDialog({ open: false, token: "", busy: false, error: null });
  };

  const submitElevatedDialog = async (): Promise<void> => {
    const snapshot = elevatedDialogRef.current;
    if (!snapshot.open || snapshot.busy) return;

    setElevatedDialog((prev) => ({ ...prev, busy: true, error: null }));
    try {
      await runtime.enterElevatedMode(snapshot.token);
      setElevatedDialog({ open: false, token: "", busy: false, error: null });
    } catch (error) {
      setElevatedDialog((prev) => ({ ...prev, busy: false, error: toErrorMessage(error) }));
    }
  };

  const [memorySearchDialog, setMemorySearchDialog] = useState<{
    open: boolean;
    query: string;
    busy: boolean;
    error: string | null;
  }>({ open: false, query: "", busy: false, error: null });
  const memorySearchDialogRef = useRef(memorySearchDialog);
  memorySearchDialogRef.current = memorySearchDialog;

  const openMemorySearchDialog = (): void => {
    const snapshot = coreRef.current.memoryStore.getSnapshot();
    setMemorySearchDialog({
      open: true,
      query:
        snapshot.browse.request?.kind === "search" && snapshot.browse.request.query
          ? snapshot.browse.request.query
          : "",
      busy: false,
      error: null,
    });
  };

  const closeMemorySearchDialog = (): void => {
    if (memorySearchDialogRef.current.busy) return;
    setMemorySearchDialog({ open: false, query: "", busy: false, error: null });
  };

  const submitMemorySearchDialog = async (): Promise<void> => {
    const snapshot = memorySearchDialogRef.current;
    if (!snapshot.open || snapshot.busy) return;

    const query = snapshot.query.trim();
    setMemorySearchDialog((prev) => ({ ...prev, busy: true, error: null }));
    try {
      if (!query) {
        await coreRef.current.memoryStore.list();
      } else {
        await coreRef.current.memoryStore.search({ query });
      }
      setMemorySearchDialog({ open: false, query: "", busy: false, error: null });
    } catch (error) {
      setMemorySearchDialog((prev) => ({ ...prev, busy: false, error: toErrorMessage(error) }));
    }
  };

  const [memoryForgetDialog, setMemoryForgetDialog] = useState<{
    open: boolean;
    memoryItemId: string | null;
    confirmText: string;
    busy: boolean;
    error: string | null;
  }>({ open: false, memoryItemId: null, confirmText: "", busy: false, error: null });
  const memoryForgetDialogRef = useRef(memoryForgetDialog);
  memoryForgetDialogRef.current = memoryForgetDialog;

  const openMemoryForgetDialog = (memoryItemId: string): void => {
    setMemoryForgetDialog({
      open: true,
      memoryItemId,
      confirmText: "",
      busy: false,
      error: null,
    });
  };

  const closeMemoryForgetDialog = (): void => {
    if (memoryForgetDialogRef.current.busy) return;
    setMemoryForgetDialog({
      open: false,
      memoryItemId: null,
      confirmText: "",
      busy: false,
      error: null,
    });
  };

  const submitMemoryForgetDialog = async (): Promise<void> => {
    const snapshot = memoryForgetDialogRef.current;
    if (!snapshot.open || snapshot.busy) return;
    if (!snapshot.memoryItemId) return;

    if (snapshot.confirmText !== "FORGET") {
      setMemoryForgetDialog((prev) => ({ ...prev, error: "Type FORGET to confirm" }));
      return;
    }

    setMemoryForgetDialog((prev) => ({ ...prev, busy: true, error: null }));
    try {
      await coreRef.current.memoryStore.forget([
        { kind: "id", memory_item_id: snapshot.memoryItemId },
      ]);

      const storeError = coreRef.current.memoryStore.getSnapshot().tombstones.error;
      if (storeError) {
        setMemoryForgetDialog((prev) => ({ ...prev, busy: false, error: storeError.message }));
        return;
      }

      setMemoryForgetDialog({
        open: false,
        memoryItemId: null,
        confirmText: "",
        busy: false,
        error: null,
      });
    } catch (error) {
      setMemoryForgetDialog((prev) => ({ ...prev, busy: false, error: toErrorMessage(error) }));
    }
  };

  useInput((input, key) => {
    const rawKey = key as unknown as Record<string, unknown>;

    if (rawKey["ctrl"] === true && input === "c") {
      exit();
      return;
    }

    if (elevatedDialogRef.current.open) {
      if (rawKey["escape"] === true) {
        closeElevatedDialog();
        return;
      }
      if (rawKey["return"] === true || rawKey["enter"] === true) {
        void submitElevatedDialog();
        return;
      }
      if (rawKey["backspace"] === true || rawKey["delete"] === true) {
        setElevatedDialog((prev) => ({
          ...prev,
          token: prev.token.length > 0 ? prev.token.slice(0, -1) : prev.token,
          error: null,
        }));
        return;
      }
      if (input) {
        setElevatedDialog((prev) => ({ ...prev, token: prev.token + input, error: null }));
      }
      return;
    }

    if (memorySearchDialogRef.current.open) {
      if (rawKey["escape"] === true) {
        closeMemorySearchDialog();
        return;
      }
      if (rawKey["return"] === true || rawKey["enter"] === true) {
        void submitMemorySearchDialog();
        return;
      }
      if (rawKey["backspace"] === true || rawKey["delete"] === true) {
        setMemorySearchDialog((prev) => ({
          ...prev,
          query: prev.query.length > 0 ? prev.query.slice(0, -1) : prev.query,
          error: null,
        }));
        return;
      }
      if (input) {
        setMemorySearchDialog((prev) => ({ ...prev, query: prev.query + input, error: null }));
      }
      return;
    }

    if (memoryForgetDialogRef.current.open) {
      if (rawKey["escape"] === true) {
        closeMemoryForgetDialog();
        return;
      }
      if (rawKey["return"] === true || rawKey["enter"] === true) {
        void submitMemoryForgetDialog();
        return;
      }
      if (rawKey["backspace"] === true || rawKey["delete"] === true) {
        setMemoryForgetDialog((prev) => ({
          ...prev,
          confirmText:
            prev.confirmText.length > 0 ? prev.confirmText.slice(0, -1) : prev.confirmText,
          error: null,
        }));
        return;
      }
      if (input) {
        setMemoryForgetDialog((prev) => ({
          ...prev,
          confirmText: prev.confirmText + input,
          error: null,
        }));
      }
      return;
    }

    const core = coreRef.current;
    const approvals = core.approvalsStore.getSnapshot();
    const pairing = core.pairingStore.getSnapshot();
    const runs = core.runsStore.getSnapshot();
    const memory = core.memoryStore.getSnapshot();

    const pairingIds = getPairingIds(pairing);
    const runIds = getRunList(runs)
      .slice(0, MAX_RUNS_VISIBLE)
      .map((run) => run.run_id);

    const memoryItemIds = memory.browse.results
      ? memory.browse.results.kind === "list"
        ? memory.browse.results.items.map((item) => item.memory_item_id)
        : memory.browse.results.hits.map((hit) => hit.memory_item_id)
      : [];

    const reduced = reduceTuiInput({
      state: uiStateRef.current,
      input,
      key: toTuiKey(key),
      elevatedModeActive: isElevatedModeActive(core.elevatedModeStore.getSnapshot()),
      approvalsPendingIds: approvals.pendingIds,
      pairingIds,
      runIds,
      memoryItemIds,
    });

    uiStateRef.current = reduced.state;
    setUiState(reduced.state);

    const execute = (command: TuiCommand): void => {
      switch (command.type) {
        case "exit":
          exit();
          return;
        case "connect":
          core.connect();
          return;
        case "disconnect":
          core.disconnect();
          return;
        case "openElevatedMode":
          openElevatedDialog();
          return;
        case "exitElevatedMode":
          runtime.exitElevatedMode();
          return;
        case "refreshMemory":
          if (memory.browse.request?.kind === "search") {
            void core.memoryStore.search({
              query: memory.browse.request.query,
              filter: memory.browse.request.filter,
              limit: memory.browse.request.limit,
            });
            return;
          }
          void core.memoryStore.list({
            filter: memory.browse.request?.filter,
            limit: memory.browse.request?.limit,
          });
          return;
        case "openMemorySearch":
          openMemorySearchDialog();
          return;
        case "openMemoryForget":
          openMemoryForgetDialog(command.memoryItemId);
          return;
        case "exportMemory":
          void core.memoryStore.export().catch(() => {});
          return;
        case "refreshApprovals":
          void core.approvalsStore.refreshPending();
          return;
        case "resolveApproval":
          void core.approvalsStore.resolve(command.approvalId, command.decision);
          return;
        case "refreshPairing":
          void core.pairingStore.refresh();
          return;
        case "approvePairing": {
          const req = core.pairingStore.getSnapshot().byId[command.pairingId];
          if (!req || req.status !== "pending") return;
          void core.pairingStore.approve(command.pairingId, {
            trust_level: "local",
            capability_allowlist: req.capability_allowlist,
          });
          return;
        }
        case "denyPairing": {
          const req = core.pairingStore.getSnapshot().byId[command.pairingId];
          if (!req || req.status !== "pending") return;
          void core.pairingStore.deny(command.pairingId);
          return;
        }
        case "revokePairing": {
          const req = core.pairingStore.getSnapshot().byId[command.pairingId];
          if (!req || req.status !== "approved") return;
          void core.pairingStore.revoke(command.pairingId);
          return;
        }
        default: {
          const exhaustive: never = command;
          return exhaustive;
        }
      }
    };

    for (const command of reduced.commands) {
      execute(command);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <AppHeader title={`Tyrum TUI (${uiState.route})`} elevatedMode={elevatedMode} />
      {elevatedDialog.open ? (
        <ElevatedModeDialog
          token={elevatedDialog.token}
          busy={elevatedDialog.busy}
          error={elevatedDialog.error}
        />
      ) : null}
      {memorySearchDialog.open ? (
        <MemorySearchDialog
          query={memorySearchDialog.query}
          busy={memorySearchDialog.busy}
          error={memorySearchDialog.error}
        />
      ) : null}
      {memoryForgetDialog.open && memoryForgetDialog.memoryItemId ? (
        <MemoryForgetDialog
          memoryItemId={memoryForgetDialog.memoryItemId}
          confirmText={memoryForgetDialog.confirmText}
          busy={memoryForgetDialog.busy}
          error={memoryForgetDialog.error}
        />
      ) : null}
      {uiState.route === "connect" ? <ConnectScreen core={core} config={config} /> : null}
      {uiState.route === "status" ? <StatusScreen core={core} /> : null}
      {uiState.route === "approvals" ? (
        <ApprovalsScreen
          core={core}
          cursor={uiState.approvalsCursor}
          selectedId={uiState.approvalsSelectedId}
        />
      ) : null}
      {uiState.route === "pairing" ? (
        <PairingScreen
          core={core}
          cursor={uiState.pairingCursor}
          selectedId={uiState.pairingSelectedId}
        />
      ) : null}
      {uiState.route === "runs" ? (
        <RunsScreen core={core} cursor={uiState.runsCursor} selectedId={uiState.runsSelectedId} />
      ) : null}
      {uiState.route === "memory" ? (
        <MemoryScreen
          core={core}
          cursor={uiState.memoryCursor}
          selectedId={uiState.memorySelectedId}
        />
      ) : null}
    </Box>
  );
}
