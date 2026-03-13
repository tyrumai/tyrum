import { describe, expect, it } from "vitest";
import { createInitialTuiUiState, reduceTuiInput } from "../src/tui-input.js";

function reduce(
  input: string,
  overrides: Partial<{
    state: ReturnType<typeof createInitialTuiUiState>;
    key: { ctrl?: boolean; upArrow?: boolean; downArrow?: boolean };
    elevatedModeActive: boolean;
    approvalsPendingIds: string[];
    pairingIds: number[];
    runIds: string[];
  }> = {},
) {
  return reduceTuiInput({
    state: overrides.state ?? createInitialTuiUiState(),
    input,
    key: overrides.key ?? {},
    elevatedModeActive: overrides.elevatedModeActive ?? false,
    approvalsPendingIds: overrides.approvalsPendingIds ?? [],
    pairingIds: overrides.pairingIds ?? [],
    runIds: overrides.runIds ?? [],
  });
}

describe("tui input reducer", () => {
  it("switches routes with number keys", () => {
    expect(reduce("3").state.route).toBe("approvals");
    expect(reduce("4").state.route).toBe("runs");
    expect(reduce("5").state.route).toBe("pairing");
  });

  it("moves approvals cursor and emits resolve command", () => {
    const approvalIds = [
      "550e8400-e29b-41d4-a716-446655440000",
      "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
    ];

    const moved = reduce("", {
      state: { ...createInitialTuiUiState(), route: "approvals" as const },
      key: { downArrow: true },
      elevatedModeActive: true,
      approvalsPendingIds: approvalIds,
    });

    expect(moved.state.approvalsCursor).toBe(1);
    expect(moved.state.approvalsSelectedId).toBe(approvalIds[1]);

    const approved = reduce("a", {
      state: moved.state,
      elevatedModeActive: true,
      approvalsPendingIds: approvalIds,
    });

    expect(approved.commands).toEqual([
      { type: "resolveApproval", approvalId: approvalIds[1], decision: "approved" },
    ]);
  });

  it("resolves the selected approval even when list order changes", () => {
    const approvalIds = [
      "550e8400-e29b-41d4-a716-446655440000",
      "6f9619ff-8b86-4d11-b42d-00c04fc964ff",
    ];

    const moved = reduce("", {
      state: { ...createInitialTuiUiState(), route: "approvals" as const },
      key: { downArrow: true },
      elevatedModeActive: true,
      approvalsPendingIds: approvalIds,
    });

    const approved = reduce("a", {
      state: moved.state,
      elevatedModeActive: true,
      approvalsPendingIds: [approvalIds[1]!, approvalIds[0]!],
    });

    expect(approved.commands).toEqual([
      { type: "resolveApproval", approvalId: approvalIds[1], decision: "approved" },
    ]);
  });

  it("requests Elevated Mode when attempting to resolve approvals while inactive", () => {
    const approvalId = "550e8400-e29b-41d4-a716-446655440000";

    const approved = reduce("a", {
      state: { ...createInitialTuiUiState(), route: "approvals" as const },
      approvalsPendingIds: [approvalId],
    });

    expect(approved.commands).toEqual([{ type: "openElevatedMode" }]);
  });

  it("emits pairing commands in pairing route", () => {
    const initial = { ...createInitialTuiUiState(), route: "pairing" as const };

    const approved = reduce("a", {
      state: initial,
      elevatedModeActive: true,
      pairingIds: [5],
    });

    expect(approved.commands).toEqual([{ type: "approvePairing", pairingId: 5 }]);

    const revoked = reduce("v", {
      state: initial,
      elevatedModeActive: true,
      pairingIds: [5],
    });

    expect(revoked.commands).toEqual([{ type: "revokePairing", pairingId: 5 }]);
  });

  it("approves the selected pairing even when list order changes", () => {
    const moved = reduce("", {
      state: { ...createInitialTuiUiState(), route: "pairing" as const },
      key: { downArrow: true },
      elevatedModeActive: true,
      pairingIds: [5, 6],
    });

    expect(moved.state.pairingSelectedId).toBe(6);

    const approved = reduce("a", {
      state: moved.state,
      elevatedModeActive: true,
      pairingIds: [6, 5],
    });

    expect(approved.commands).toEqual([{ type: "approvePairing", pairingId: 6 }]);
  });

  it("opens Elevated Mode on 'm' and exits Elevated Mode on 'e'", () => {
    expect(reduce("m").commands).toEqual([{ type: "openElevatedMode" }]);
    expect(reduce("e", { elevatedModeActive: true }).commands).toEqual([
      { type: "exitElevatedMode" },
    ]);
  });

  it("exits on ctrl+c", () => {
    expect(reduce("c", { key: { ctrl: true } }).commands).toEqual([{ type: "exit" }]);
  });
});
