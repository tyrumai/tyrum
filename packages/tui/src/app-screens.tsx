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
import { getTurnList } from "./turns-view.js";
import { getPairingIds, MAX_TURNS_VISIBLE, truncateText, useOperatorStore } from "./app-support.js";

export function AppHeader(props: { title: string; elevatedMode: ElevatedModeState }) {
  const elevatedModeActive = isElevatedModeActive(props.elevatedMode);
  return (
    <Box flexDirection="column" paddingBottom={1}>
      <Text bold>{props.title}</Text>
      <Text dimColor>
        Keys: c=connect d=disconnect 1=connect 2=status 3=approvals 4=turns 5=pairing m=elevated
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

export function TurnsScreen(props: {
  core: OperatorCore;
  cursor: number;
  selectedId: string | null;
}) {
  const turnsState = useOperatorStore(props.core.turnsStore);
  const turns = useMemo(() => getTurnList(turnsState).slice(0, MAX_TURNS_VISIBLE), [turnsState]);
  const turnIds = useMemo(() => turns.map((turn) => turn.turn_id), [turns]);
  const effectiveCursor = getEffectiveCursor({
    ids: turnIds,
    cursor: props.cursor,
    selectedId: props.selectedId,
  });
  const selectedTurn = turns[effectiveCursor] ?? null;

  return (
    <Box flexDirection="column">
      <Text dimColor>Keys: ↑/↓ select recent turns</Text>
      <Text>
        Turns: <Text bold>{String(Object.keys(turnsState.turnsById).length)}</Text> (showing{" "}
        {String(turns.length)})
      </Text>
      {turns.length === 0 ? (
        <Text dimColor>No turns yet.</Text>
      ) : (
        <Box flexDirection="column" paddingTop={1}>
          {turns.map((turn, index) => {
            const isSelected = index === effectiveCursor;
            const label = `${turn.status} ${turn.conversation_key} ${turn.turn_id.slice(0, 8)}`;
            return (
              <Text key={turn.turn_id} inverse={isSelected}>
                {isSelected ? "> " : "  "}
                {label}
              </Text>
            );
          })}
        </Box>
      )}

      {selectedTurn ? (
        <Box flexDirection="column" paddingTop={1}>
          <Text bold>Selected turn</Text>
          <Text>{selectedTurn.turn_id}</Text>
          <Text>
            Status: <Text bold>{selectedTurn.status}</Text> attempt {String(selectedTurn.attempt)}
          </Text>
          {selectedTurn.blocked_reason ? (
            <Text color="yellow">
              Paused: {selectedTurn.blocked_reason}
              {selectedTurn.blocked_detail
                ? ` — ${truncateText(selectedTurn.blocked_detail, 80)}`
                : ""}
            </Text>
          ) : null}
          <Text dimColor>
            Created: {selectedTurn.created_at}
            {selectedTurn.started_at ? ` Started: ${selectedTurn.started_at}` : ""}
            {selectedTurn.finished_at ? ` Finished: ${selectedTurn.finished_at}` : ""}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
