import { describe, expect, it } from "vitest";
import { createInitialTuiUiState, reduceTuiInput } from "../src/tui-input.js";

describe("tui input reducer", () => {
  it("switches routes with number keys", () => {
    const initial = createInitialTuiUiState();

    const next = reduceTuiInput({
      state: initial,
      input: "3",
      key: {},
      elevatedModeActive: false,
      approvalsPendingIds: [],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    expect(next.state.route).toBe("approvals");
    expect(next.commands).toEqual([]);
  });

  it("switches to memory route with '6'", () => {
    const initial = createInitialTuiUiState();

    const next = reduceTuiInput({
      state: initial,
      input: "6",
      key: {},
      elevatedModeActive: false,
      approvalsPendingIds: [],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    expect(next.state.route).toBe("memory");
    expect(next.commands).toEqual([]);
  });

  it("emits memory commands in memory route", () => {
    const initial = { ...createInitialTuiUiState(), route: "memory" as const };

    const refreshed = reduceTuiInput({
      state: initial,
      input: "r",
      key: {},
      elevatedModeActive: false,
      approvalsPendingIds: [],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    expect(refreshed.commands).toEqual([{ type: "refreshMemory" }]);

    const openSearch = reduceTuiInput({
      state: initial,
      input: "/",
      key: {},
      elevatedModeActive: false,
      approvalsPendingIds: [],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    expect(openSearch.commands).toEqual([{ type: "openMemorySearch" }]);

    const forget = reduceTuiInput({
      state: initial,
      input: "f",
      key: {},
      elevatedModeActive: true,
      approvalsPendingIds: [],
      pairingIds: [],
      runIds: [],
      memoryItemIds: ["mem-1"],
    });

    expect(forget.commands).toEqual([{ type: "openMemoryForget", memoryItemId: "mem-1" }]);

    const exportAll = reduceTuiInput({
      state: initial,
      input: "p",
      key: {},
      elevatedModeActive: true,
      approvalsPendingIds: [],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    expect(exportAll.commands).toEqual([{ type: "exportMemory" }]);
  });

  it("moves approvals cursor and emits resolve command", () => {
    const initial = { ...createInitialTuiUiState(), route: "approvals" as const };

    const moved = reduceTuiInput({
      state: initial,
      input: "",
      key: { downArrow: true },
      elevatedModeActive: true,
      approvalsPendingIds: [10, 11],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    expect(moved.state.approvalsCursor).toBe(1);
    expect(
      (moved.state as unknown as { approvalsSelectedId?: number | null }).approvalsSelectedId,
    ).toBe(11);

    const approved = reduceTuiInput({
      state: moved.state,
      input: "a",
      key: {},
      elevatedModeActive: true,
      approvalsPendingIds: [10, 11],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    expect(approved.commands).toEqual([
      { type: "resolveApproval", approvalId: 11, decision: "approved" },
    ]);
  });

  it("resolves the selected approval even when list order changes", () => {
    const initial = { ...createInitialTuiUiState(), route: "approvals" as const };

    const moved = reduceTuiInput({
      state: initial,
      input: "",
      key: { downArrow: true },
      elevatedModeActive: true,
      approvalsPendingIds: [10, 11],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    const approved = reduceTuiInput({
      state: moved.state,
      input: "a",
      key: {},
      elevatedModeActive: true,
      approvalsPendingIds: [11, 10],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    expect(approved.commands).toEqual([
      { type: "resolveApproval", approvalId: 11, decision: "approved" },
    ]);
  });

  it("requests Elevated Mode when attempting to resolve approvals while inactive", () => {
    const initial = { ...createInitialTuiUiState(), route: "approvals" as const };

    const approved = reduceTuiInput({
      state: initial,
      input: "a",
      key: {},
      elevatedModeActive: false,
      approvalsPendingIds: [10],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    expect(approved.commands).toEqual([{ type: "openElevatedMode" }]);
  });

  it("emits pairing commands in pairing route", () => {
    const initial = { ...createInitialTuiUiState(), route: "pairing" as const };

    const approved = reduceTuiInput({
      state: initial,
      input: "a",
      key: {},
      elevatedModeActive: true,
      approvalsPendingIds: [],
      pairingIds: [5],
      runIds: [],
      memoryItemIds: [],
    });

    expect(approved.commands).toEqual([{ type: "approvePairing", pairingId: 5 }]);

    const revoked = reduceTuiInput({
      state: initial,
      input: "v",
      key: {},
      elevatedModeActive: true,
      approvalsPendingIds: [],
      pairingIds: [5],
      runIds: [],
      memoryItemIds: [],
    });

    expect(revoked.commands).toEqual([{ type: "revokePairing", pairingId: 5 }]);
  });

  it("approves the selected pairing even when list order changes", () => {
    const initial = { ...createInitialTuiUiState(), route: "pairing" as const };

    const moved = reduceTuiInput({
      state: initial,
      input: "",
      key: { downArrow: true },
      elevatedModeActive: true,
      approvalsPendingIds: [],
      pairingIds: [5, 6],
      runIds: [],
      memoryItemIds: [],
    });

    expect(
      (moved.state as unknown as { pairingSelectedId?: number | null }).pairingSelectedId,
    ).toBe(6);

    const approved = reduceTuiInput({
      state: moved.state,
      input: "a",
      key: {},
      elevatedModeActive: true,
      approvalsPendingIds: [],
      pairingIds: [6, 5],
      runIds: [],
      memoryItemIds: [],
    });

    expect(approved.commands).toEqual([{ type: "approvePairing", pairingId: 6 }]);
  });

  it("opens Elevated Mode on 'm' and exits Elevated Mode on 'e'", () => {
    const initial = createInitialTuiUiState();

    const enter = reduceTuiInput({
      state: initial,
      input: "m",
      key: {},
      elevatedModeActive: false,
      approvalsPendingIds: [],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    expect(enter.commands).toEqual([{ type: "openElevatedMode" }]);

    const exit = reduceTuiInput({
      state: initial,
      input: "e",
      key: {},
      elevatedModeActive: true,
      approvalsPendingIds: [],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    expect(exit.commands).toEqual([{ type: "exitElevatedMode" }]);
  });

  it("exits on ctrl+c", () => {
    const initial = createInitialTuiUiState();

    const next = reduceTuiInput({
      state: initial,
      input: "c",
      key: { ctrl: true },
      elevatedModeActive: false,
      approvalsPendingIds: [],
      pairingIds: [],
      runIds: [],
      memoryItemIds: [],
    });

    expect(next.commands).toEqual([{ type: "exit" }]);
  });
});
