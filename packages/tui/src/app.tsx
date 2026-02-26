import type { OperatorCore } from "@tyrum/operator-core";
import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ResolvedTuiConfig } from "./config.js";
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

function AppHeader({ title }: { title: string }) {
  return (
    <Box flexDirection="column" paddingBottom={1}>
      <Text bold>{title}</Text>
      <Text dimColor>
        Keys: c=connect d=disconnect 1=connect 2=status 3=approvals 4=runs 5=pairing q=quit
      </Text>
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
  selectedId: number | null;
}) {
  const approvals = useOperatorStore(core.approvalsStore);
  const pendingIds = approvals.pendingIds;
  const effectiveCursor = getEffectiveCursor({ ids: pendingIds, cursor, selectedId });

  const selectedIdFromCursor = pendingIds[effectiveCursor];
  const selected =
    typeof selectedIdFromCursor === "number" ? approvals.byId[selectedIdFromCursor] : null;

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
  const runs = useMemo(
    () => getRunList(runsState).slice(0, MAX_RUNS_VISIBLE),
    [runsState],
  );
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
                      <Text dimColor>  No attempts yet.</Text>
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

export function TuiApp({ core, config }: { core: OperatorCore; config: ResolvedTuiConfig }) {
  const { exit } = useApp();
  const [uiState, setUiState] = useState(() => createInitialTuiUiState());
  const uiStateRef = useRef(uiState);
  uiStateRef.current = uiState;

  useEffect(() => {
    core.connect();
    return () => {
      core.disconnect();
    };
  }, [core]);

  useInput((input, key) => {
    const approvals = core.approvalsStore.getSnapshot();
    const pairing = core.pairingStore.getSnapshot();
    const runs = core.runsStore.getSnapshot();

    const pairingIds = getPairingIds(pairing);
    const runIds = getRunList(runs).slice(0, MAX_RUNS_VISIBLE).map((run) => run.run_id);

    const reduced = reduceTuiInput({
      state: uiStateRef.current,
      input,
      key: toTuiKey(key),
      approvalsPendingIds: approvals.pendingIds,
      pairingIds,
      runIds,
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
      <AppHeader title={`Tyrum TUI (${uiState.route})`} />
      {uiState.route === "connect" ? (
        <ConnectScreen core={core} config={config} />
      ) : null}
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
    </Box>
  );
}
