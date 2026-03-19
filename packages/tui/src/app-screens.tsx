import {
  formatElevatedModeRemaining,
  isElevatedModeActive,
  type ElevatedModeState,
  type OperatorCore,
} from "@tyrum/operator-app";
import { Box, Text } from "ink";
import { useMemo } from "react";
import type { ResolvedTuiConfig } from "./config.js";
import { getEffectiveCursor } from "./tui-input.js";
import { getAttemptsForStep, getRunList, getStepsForRun } from "./runs-view.js";
import { getPairingIds, MAX_RUNS_VISIBLE, truncateText, useOperatorStore } from "./app-support.js";

export function AppHeader(props: { title: string; elevatedMode: ElevatedModeState }) {
  const elevatedModeActive = isElevatedModeActive(props.elevatedMode);
  return (
    <Box flexDirection="column" paddingBottom={1}>
      <Text bold>{props.title}</Text>
      <Text dimColor>
        Keys: c=connect d=disconnect 1=connect 2=status 3=approvals 4=runs 5=pairing m=elevated
        q=quit
      </Text>
      {elevatedModeActive ? (
        <Text color="yellow">
          Elevated Mode active · {formatElevatedModeRemaining(props.elevatedMode)} remaining
          (e=exit)
        </Text>
      ) : null}
    </Box>
  );
}

export function ConnectScreen(props: {
  core: OperatorCore;
  config: Pick<ResolvedTuiConfig, "httpBaseUrl" | "wsUrl" | "deviceIdentityPath">;
}) {
  const connection = useOperatorStore(props.core.connectionStore);

  return (
    <Box flexDirection="column">
      <Text>
        Gateway: <Text bold>{props.config.httpBaseUrl}</Text>
      </Text>
      <Text>
        WS: <Text bold>{props.config.wsUrl}</Text>
      </Text>
      <Text>
        Device identity: <Text bold>{props.config.deviceIdentityPath}</Text>
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

export function StatusScreen(props: { core: OperatorCore }) {
  const connection = useOperatorStore(props.core.connectionStore);
  const approvals = useOperatorStore(props.core.approvalsStore);
  const pairing = useOperatorStore(props.core.pairingStore);
  const status = useOperatorStore(props.core.statusStore);
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

export function ApprovalsScreen(props: {
  core: OperatorCore;
  cursor: number;
  selectedId: string | null;
}) {
  const approvals = useOperatorStore(props.core.approvalsStore);
  const pendingIds = approvals.pendingIds;
  const effectiveCursor = getEffectiveCursor({
    ids: pendingIds,
    cursor: props.cursor,
    selectedId: props.selectedId,
  });
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

export function PairingScreen(props: {
  core: OperatorCore;
  cursor: number;
  selectedId: number | null;
}) {
  const pairing = useOperatorStore(props.core.pairingStore);
  const pairingIds = useMemo(() => getPairingIds(pairing), [pairing]);
  const effectiveCursor = getEffectiveCursor({
    ids: pairingIds,
    cursor: props.cursor,
    selectedId: props.selectedId,
  });
  const selectedIdFromCursor = pairingIds[effectiveCursor];
  const selected =
    typeof selectedIdFromCursor === "number" ? pairing.byId[selectedIdFromCursor] : null;

  return (
    <Box flexDirection="column">
      <Text dimColor>Keys: ↑/↓ select a=approve x=deny v=revoke r=refresh</Text>
      <Text>
        Pending: <Text bold>{String(pairing.pendingIds.length)}</Text> Total:{" "}
        {String(pairingIds.length)}
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

export function RunsScreen(props: {
  core: OperatorCore;
  cursor: number;
  selectedId: string | null;
}) {
  const runsState = useOperatorStore(props.core.runsStore);
  const runs = useMemo(() => getRunList(runsState).slice(0, MAX_RUNS_VISIBLE), [runsState]);
  const runIds = useMemo(() => runs.map((run) => run.run_id), [runs]);
  const effectiveCursor = getEffectiveCursor({
    ids: runIds,
    cursor: props.cursor,
    selectedId: props.selectedId,
  });
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
