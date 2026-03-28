import { isElevatedModeActive } from "@tyrum/operator-app";
import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import type { ResolvedTuiConfig } from "./config.js";
import type { TuiRuntime } from "./core.js";
import {
  getPairingIds,
  maskToken,
  MAX_TURNS_VISIBLE,
  toErrorMessage,
  toTuiKey,
  useOperatorCoreManager,
  useOperatorStore,
} from "./app-support.js";
import {
  AppHeader,
  ApprovalsScreen,
  ConnectScreen,
  PairingScreen,
  TurnsScreen,
  StatusScreen,
} from "./app-screens.js";
import { createInitialTuiUiState, reduceTuiInput, type TuiCommand } from "./tui-input.js";
import { getTurnList } from "./turns-view.js";

type ElevatedDialogState = {
  open: boolean;
  token: string;
  busy: boolean;
  error: string | null;
};

function createClosedElevatedDialog(): ElevatedDialogState {
  return { open: false, token: "", busy: false, error: null };
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

  const [elevatedDialog, setElevatedDialog] = useState(createClosedElevatedDialog);
  const elevatedDialogRef = useRef(elevatedDialog);
  elevatedDialogRef.current = elevatedDialog;

  const openElevatedDialog = (): void => {
    setElevatedDialog({ ...createClosedElevatedDialog(), open: true });
  };

  const closeElevatedDialog = (): void => {
    if (elevatedDialogRef.current.busy) return;
    setElevatedDialog(createClosedElevatedDialog());
  };

  const submitElevatedDialog = async (): Promise<void> => {
    const snapshot = elevatedDialogRef.current;
    if (!snapshot.open || snapshot.busy) return;

    setElevatedDialog((prev) => ({ ...prev, busy: true, error: null }));
    try {
      await runtime.enterElevatedMode(snapshot.token);
      setElevatedDialog(createClosedElevatedDialog());
    } catch (error) {
      setElevatedDialog((prev) => ({ ...prev, busy: false, error: toErrorMessage(error) }));
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

    const currentCore = coreRef.current;
    const approvals = currentCore.approvalsStore.getSnapshot();
    const pairing = currentCore.pairingStore.getSnapshot();
    const turns = currentCore.turnsStore.getSnapshot();

    const pairingIds = getPairingIds(pairing);
    const turnIds = getTurnList(turns)
      .slice(0, MAX_TURNS_VISIBLE)
      .map((turn) => turn.turn_id);

    const reduced = reduceTuiInput({
      state: uiStateRef.current,
      input,
      key: toTuiKey(key),
      elevatedModeActive: isElevatedModeActive(currentCore.elevatedModeStore.getSnapshot()),
      approvalsPendingIds: approvals.pendingIds,
      pairingIds,
      turnIds,
    });

    uiStateRef.current = reduced.state;
    setUiState(reduced.state);

    const execute = (command: TuiCommand): void => {
      switch (command.type) {
        case "exit":
          exit();
          return;
        case "connect":
          currentCore.connect();
          return;
        case "disconnect":
          currentCore.disconnect();
          return;
        case "openElevatedMode":
          openElevatedDialog();
          return;
        case "exitElevatedMode":
          runtime.exitElevatedMode();
          return;
        case "refreshApprovals":
          void currentCore.approvalsStore.refreshPending();
          return;
        case "resolveApproval":
          void currentCore.approvalsStore.resolve({
            approvalId: command.approvalId,
            decision: command.decision,
          });
          return;
        case "refreshPairing":
          void currentCore.pairingStore.refresh();
          return;
        case "approvePairing": {
          const req = currentCore.pairingStore.getSnapshot().byId[command.pairingId];
          if (!req || (req.status !== "queued" && req.status !== "awaiting_human")) return;
          void currentCore.pairingStore.approve(command.pairingId, {
            trust_level: "local",
            capability_allowlist: req.capability_allowlist,
          });
          return;
        }
        case "denyPairing": {
          const req = currentCore.pairingStore.getSnapshot().byId[command.pairingId];
          if (!req || (req.status !== "queued" && req.status !== "awaiting_human")) return;
          void currentCore.pairingStore.deny(command.pairingId);
          return;
        }
        case "revokePairing": {
          const req = currentCore.pairingStore.getSnapshot().byId[command.pairingId];
          if (!req || req.status !== "approved") return;
          void currentCore.pairingStore.revoke(command.pairingId);
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
      {uiState.route === "turns" ? (
        <TurnsScreen
          core={core}
          cursor={uiState.turnsCursor}
          selectedId={uiState.turnsSelectedId}
        />
      ) : null}
    </Box>
  );
}
