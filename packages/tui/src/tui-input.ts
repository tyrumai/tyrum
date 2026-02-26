export type TuiRouteId = "connect" | "status" | "approvals" | "runs" | "pairing";

export type TuiKey = {
  ctrl?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
};

export type TuiUiState = {
  route: TuiRouteId;
  approvalsCursor: number;
  approvalsSelectedId: number | null;
  pairingCursor: number;
  pairingSelectedId: number | null;
  runsCursor: number;
  runsSelectedId: string | null;
};

export type TuiCommand =
  | { type: "exit" }
  | { type: "connect" }
  | { type: "disconnect" }
  | { type: "refreshApprovals" }
  | { type: "resolveApproval"; approvalId: number; decision: "approved" | "denied" }
  | { type: "refreshPairing" }
  | { type: "approvePairing"; pairingId: number }
  | { type: "denyPairing"; pairingId: number }
  | { type: "revokePairing"; pairingId: number };

export function createInitialTuiUiState(): TuiUiState {
  return {
    route: "connect",
    approvalsCursor: 0,
    approvalsSelectedId: null,
    pairingCursor: 0,
    pairingSelectedId: null,
    runsCursor: 0,
    runsSelectedId: null,
  };
}

function clampCursor(cursor: number, total: number): number {
  if (total <= 0) return 0;
  if (!Number.isFinite(cursor)) return 0;
  if (cursor < 0) return 0;
  if (cursor >= total) return total - 1;
  return cursor;
}

export function getEffectiveCursor<T>(params: {
  ids: readonly T[];
  selectedId: T | null;
  cursor: number;
}): number {
  if (params.ids.length === 0) return 0;
  if (params.selectedId !== null) {
    const index = params.ids.indexOf(params.selectedId);
    if (index >= 0) return index;
  }
  return clampCursor(params.cursor, params.ids.length);
}

export function reduceTuiInput(_params: {
  state: TuiUiState;
  input: string;
  key: TuiKey;
  approvalsPendingIds: number[];
  pairingIds: number[];
  runIds: string[];
}): { state: TuiUiState; commands: TuiCommand[] } {
  const commands: TuiCommand[] = [];
  const input = _params.input;
  const key = _params.key;

  if (key.ctrl && input === "c") {
    commands.push({ type: "exit" });
    return { state: _params.state, commands };
  }

  if (input === "q") {
    commands.push({ type: "exit" });
    return { state: _params.state, commands };
  }

  const setRoute = (route: TuiRouteId): TuiUiState => ({
    ..._params.state,
    route,
    approvalsCursor: 0,
    approvalsSelectedId: null,
    pairingCursor: 0,
    pairingSelectedId: null,
    runsCursor: 0,
    runsSelectedId: null,
  });

  switch (input) {
    case "1":
      return { state: setRoute("connect"), commands };
    case "2":
      return { state: setRoute("status"), commands };
    case "3":
      return { state: setRoute("approvals"), commands };
    case "4":
      return { state: setRoute("runs"), commands };
    case "5":
      return { state: setRoute("pairing"), commands };
    case "c":
      commands.push({ type: "connect" });
      return { state: _params.state, commands };
    case "d":
      commands.push({ type: "disconnect" });
      return { state: _params.state, commands };
    default:
      break;
  }

  if (_params.state.route === "approvals") {
    const cursor = getEffectiveCursor({
      ids: _params.approvalsPendingIds,
      selectedId: _params.state.approvalsSelectedId,
      cursor: _params.state.approvalsCursor,
    });
    const max = Math.max(0, _params.approvalsPendingIds.length - 1);

    if (key.downArrow) {
      const nextCursor = Math.min(cursor + 1, max);
      return {
        state: {
          ..._params.state,
          approvalsCursor: nextCursor,
          approvalsSelectedId: _params.approvalsPendingIds[nextCursor] ?? null,
        },
        commands,
      };
    }
    if (key.upArrow) {
      const nextCursor = Math.max(cursor - 1, 0);
      return {
        state: {
          ..._params.state,
          approvalsCursor: nextCursor,
          approvalsSelectedId: _params.approvalsPendingIds[nextCursor] ?? null,
        },
        commands,
      };
    }

    if (input === "r") {
      commands.push({ type: "refreshApprovals" });
      return { state: { ..._params.state, approvalsCursor: cursor }, commands };
    }

    if (input === "a" || input === "x") {
      const approvalId = _params.approvalsPendingIds[cursor];
      if (typeof approvalId === "number") {
        commands.push({
          type: "resolveApproval",
          approvalId,
          decision: input === "a" ? "approved" : "denied",
        });
      }
      return {
        state: {
          ..._params.state,
          approvalsCursor: cursor,
          approvalsSelectedId: typeof approvalId === "number" ? approvalId : null,
        },
        commands,
      };
    }
  }

  if (_params.state.route === "pairing") {
    const cursor = getEffectiveCursor({
      ids: _params.pairingIds,
      selectedId: _params.state.pairingSelectedId,
      cursor: _params.state.pairingCursor,
    });
    const max = Math.max(0, _params.pairingIds.length - 1);

    if (key.downArrow) {
      const nextCursor = Math.min(cursor + 1, max);
      return {
        state: {
          ..._params.state,
          pairingCursor: nextCursor,
          pairingSelectedId: _params.pairingIds[nextCursor] ?? null,
        },
        commands,
      };
    }
    if (key.upArrow) {
      const nextCursor = Math.max(cursor - 1, 0);
      return {
        state: {
          ..._params.state,
          pairingCursor: nextCursor,
          pairingSelectedId: _params.pairingIds[nextCursor] ?? null,
        },
        commands,
      };
    }

    if (input === "r") {
      commands.push({ type: "refreshPairing" });
      return { state: { ..._params.state, pairingCursor: cursor }, commands };
    }

    const pairingId = _params.pairingIds[cursor];
    if (typeof pairingId === "number") {
      if (input === "a") {
        commands.push({ type: "approvePairing", pairingId });
        return {
          state: { ..._params.state, pairingCursor: cursor, pairingSelectedId: pairingId },
          commands,
        };
      }
      if (input === "x") {
        commands.push({ type: "denyPairing", pairingId });
        return {
          state: { ..._params.state, pairingCursor: cursor, pairingSelectedId: pairingId },
          commands,
        };
      }
      if (input === "v") {
        commands.push({ type: "revokePairing", pairingId });
        return {
          state: { ..._params.state, pairingCursor: cursor, pairingSelectedId: pairingId },
          commands,
        };
      }
    }
  }

  if (_params.state.route === "runs") {
    const cursor = getEffectiveCursor({
      ids: _params.runIds,
      selectedId: _params.state.runsSelectedId,
      cursor: _params.state.runsCursor,
    });
    const max = Math.max(0, _params.runIds.length - 1);
    if (key.downArrow) {
      const nextCursor = Math.min(cursor + 1, max);
      return {
        state: {
          ..._params.state,
          runsCursor: nextCursor,
          runsSelectedId: _params.runIds[nextCursor] ?? null,
        },
        commands,
      };
    }
    if (key.upArrow) {
      const nextCursor = Math.max(cursor - 1, 0);
      return {
        state: {
          ..._params.state,
          runsCursor: nextCursor,
          runsSelectedId: _params.runIds[nextCursor] ?? null,
        },
        commands,
      };
    }
    return { state: { ..._params.state, runsCursor: cursor }, commands };
  }

  return { state: _params.state, commands };
}
