export type TuiRouteId = "connect" | "status" | "approvals" | "runs" | "pairing";

export type TuiKey = {
  ctrl?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
};

export type TuiUiState = {
  route: TuiRouteId;
  approvalsCursor: number;
  pairingCursor: number;
  runsCursor: number;
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
    pairingCursor: 0,
    runsCursor: 0,
  };
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
    pairingCursor: 0,
    runsCursor: 0,
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
    const max = Math.max(0, _params.approvalsPendingIds.length - 1);
    const cursor = Math.max(0, Math.min(_params.state.approvalsCursor, max));

    if (key.downArrow) {
      return { state: { ..._params.state, approvalsCursor: Math.min(cursor + 1, max) }, commands };
    }
    if (key.upArrow) {
      return { state: { ..._params.state, approvalsCursor: Math.max(cursor - 1, 0) }, commands };
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
      return { state: { ..._params.state, approvalsCursor: cursor }, commands };
    }
  }

  if (_params.state.route === "pairing") {
    const max = Math.max(0, _params.pairingIds.length - 1);
    const cursor = Math.max(0, Math.min(_params.state.pairingCursor, max));

    if (key.downArrow) {
      return { state: { ..._params.state, pairingCursor: Math.min(cursor + 1, max) }, commands };
    }
    if (key.upArrow) {
      return { state: { ..._params.state, pairingCursor: Math.max(cursor - 1, 0) }, commands };
    }

    if (input === "r") {
      commands.push({ type: "refreshPairing" });
      return { state: { ..._params.state, pairingCursor: cursor }, commands };
    }

    const pairingId = _params.pairingIds[cursor];
    if (typeof pairingId === "number") {
      if (input === "a") {
        commands.push({ type: "approvePairing", pairingId });
        return { state: { ..._params.state, pairingCursor: cursor }, commands };
      }
      if (input === "x") {
        commands.push({ type: "denyPairing", pairingId });
        return { state: { ..._params.state, pairingCursor: cursor }, commands };
      }
      if (input === "v") {
        commands.push({ type: "revokePairing", pairingId });
        return { state: { ..._params.state, pairingCursor: cursor }, commands };
      }
    }
  }

  if (_params.state.route === "runs") {
    const max = Math.max(0, _params.runIds.length - 1);
    const cursor = Math.max(0, Math.min(_params.state.runsCursor, max));
    if (key.downArrow) {
      return { state: { ..._params.state, runsCursor: Math.min(cursor + 1, max) }, commands };
    }
    if (key.upArrow) {
      return { state: { ..._params.state, runsCursor: Math.max(cursor - 1, 0) }, commands };
    }
    return { state: { ..._params.state, runsCursor: cursor }, commands };
  }

  return { state: _params.state, commands };
}
