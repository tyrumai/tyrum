import { isElevatedModeActive } from "@tyrum/operator-core";
import { Box, useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import type { ResolvedTuiConfig } from "./config.js";
import type { TuiRuntime } from "./core.js";
import {
  ElevatedModeDialog,
  MemoryForgetDialog,
  MemoryScreen,
  MemorySearchDialog,
} from "./app-memory.js";
import {
  getMemoryBrowseIds,
  getPairingIds,
  MAX_RUNS_VISIBLE,
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
  RunsScreen,
  StatusScreen,
} from "./app-screens.js";
import { createInitialTuiUiState, reduceTuiInput, type TuiCommand } from "./tui-input.js";
import { getRunList } from "./runs-view.js";

type ElevatedDialogState = {
  open: boolean;
  token: string;
  busy: boolean;
  error: string | null;
};

type MemorySearchDialogState = {
  open: boolean;
  query: string;
  busy: boolean;
  error: string | null;
};

type MemoryForgetDialogState = {
  open: boolean;
  memoryItemId: string | null;
  confirmText: string;
  busy: boolean;
  error: string | null;
};

function createClosedElevatedDialog(): ElevatedDialogState {
  return { open: false, token: "", busy: false, error: null };
}

function createClosedMemorySearchDialog(): MemorySearchDialogState {
  return { open: false, query: "", busy: false, error: null };
}

function createClosedMemoryForgetDialog(): MemoryForgetDialogState {
  return { open: false, memoryItemId: null, confirmText: "", busy: false, error: null };
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

  const [memorySearchDialog, setMemorySearchDialog] = useState(createClosedMemorySearchDialog);
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
    setMemorySearchDialog(createClosedMemorySearchDialog());
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
      setMemorySearchDialog(createClosedMemorySearchDialog());
    } catch (error) {
      setMemorySearchDialog((prev) => ({ ...prev, busy: false, error: toErrorMessage(error) }));
    }
  };

  const [memoryForgetDialog, setMemoryForgetDialog] = useState(createClosedMemoryForgetDialog);
  const memoryForgetDialogRef = useRef(memoryForgetDialog);
  memoryForgetDialogRef.current = memoryForgetDialog;

  const openMemoryForgetDialog = (memoryItemId: string): void => {
    setMemoryForgetDialog({ ...createClosedMemoryForgetDialog(), open: true, memoryItemId });
  };

  const closeMemoryForgetDialog = (): void => {
    if (memoryForgetDialogRef.current.busy) return;
    setMemoryForgetDialog(createClosedMemoryForgetDialog());
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

      setMemoryForgetDialog(createClosedMemoryForgetDialog());
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

    const currentCore = coreRef.current;
    const approvals = currentCore.approvalsStore.getSnapshot();
    const pairing = currentCore.pairingStore.getSnapshot();
    const runs = currentCore.runsStore.getSnapshot();
    const memory = currentCore.memoryStore.getSnapshot();

    const pairingIds = getPairingIds(pairing);
    const runIds = getRunList(runs)
      .slice(0, MAX_RUNS_VISIBLE)
      .map((run) => run.run_id);
    const memoryItemIds = getMemoryBrowseIds(memory);

    const reduced = reduceTuiInput({
      state: uiStateRef.current,
      input,
      key: toTuiKey(key),
      elevatedModeActive: isElevatedModeActive(currentCore.elevatedModeStore.getSnapshot()),
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
        case "refreshMemory":
          if (memory.browse.request?.kind === "search") {
            void currentCore.memoryStore.search({
              query: memory.browse.request.query,
              filter: memory.browse.request.filter,
              limit: memory.browse.request.limit,
            });
            return;
          }
          void currentCore.memoryStore.list({
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
          void currentCore.memoryStore.export().catch(() => {});
          return;
        case "refreshApprovals":
          void currentCore.approvalsStore.refreshPending();
          return;
        case "resolveApproval":
          void currentCore.approvalsStore.resolve(command.approvalId, command.decision);
          return;
        case "refreshPairing":
          void currentCore.pairingStore.refresh();
          return;
        case "approvePairing": {
          const req = currentCore.pairingStore.getSnapshot().byId[command.pairingId];
          if (!req || req.status !== "pending") return;
          void currentCore.pairingStore.approve(command.pairingId, {
            trust_level: "local",
            capability_allowlist: req.capability_allowlist,
          });
          return;
        }
        case "denyPairing": {
          const req = currentCore.pairingStore.getSnapshot().byId[command.pairingId];
          if (!req || req.status !== "pending") return;
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
