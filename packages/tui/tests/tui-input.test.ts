import { describe, expect, it } from "vitest";
import { createInitialTuiUiState, reduceTuiInput } from "../src/tui-input.js";

describe("tui input reducer", () => {
  it("switches routes with number keys", () => {
    const initial = createInitialTuiUiState();

    const next = reduceTuiInput({
      state: initial,
      input: "3",
      key: {},
      approvalsPendingIds: [],
      pairingIds: [],
      runIds: [],
    });

    expect(next.state.route).toBe("approvals");
    expect(next.commands).toEqual([]);
  });

  it("moves approvals cursor and emits resolve command", () => {
    const initial = { ...createInitialTuiUiState(), route: "approvals" as const };

    const moved = reduceTuiInput({
      state: initial,
      input: "",
      key: { downArrow: true },
      approvalsPendingIds: [10, 11],
      pairingIds: [],
      runIds: [],
    });

    expect(moved.state.approvalsCursor).toBe(1);

    const approved = reduceTuiInput({
      state: moved.state,
      input: "a",
      key: {},
      approvalsPendingIds: [10, 11],
      pairingIds: [],
      runIds: [],
    });

    expect(approved.commands).toEqual([
      { type: "resolveApproval", approvalId: 11, decision: "approved" },
    ]);
  });

  it("emits pairing commands in pairing route", () => {
    const initial = { ...createInitialTuiUiState(), route: "pairing" as const };

    const approved = reduceTuiInput({
      state: initial,
      input: "a",
      key: {},
      approvalsPendingIds: [],
      pairingIds: [5],
      runIds: [],
    });

    expect(approved.commands).toEqual([{ type: "approvePairing", pairingId: 5 }]);

    const revoked = reduceTuiInput({
      state: initial,
      input: "v",
      key: {},
      approvalsPendingIds: [],
      pairingIds: [5],
      runIds: [],
    });

    expect(revoked.commands).toEqual([{ type: "revokePairing", pairingId: 5 }]);
  });

  it("exits on ctrl+c", () => {
    const initial = createInitialTuiUiState();

    const next = reduceTuiInput({
      state: initial,
      input: "c",
      key: { ctrl: true },
      approvalsPendingIds: [],
      pairingIds: [],
      runIds: [],
    });

    expect(next.commands).toEqual([{ type: "exit" }]);
  });
});

