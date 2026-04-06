import { describe, expect, it } from "vitest";
import type { Turn, TurnItem } from "@tyrum/contracts";
import { createTurnsStore } from "../src/stores/turns-store.js";

describe("createTurnsStore", () => {
  it("indexes turns and hydrates trigger kinds from turn.list", async () => {
    const run = { turn_id: "run-1" } as unknown as Turn;
    const { store, handleTurnUpdated } = createTurnsStore({
      turnList: async () => ({
        turns: [{ turn: run, trigger_kind: "heartbeat" as const }],
      }),
    } as never);

    await store.refreshRecent();
    expect(store.getSnapshot().turnsById["run-1"]).toBe(run);
    expect(store.getSnapshot().triggerKindByTurnId?.["run-1"]).toBe("heartbeat");

    handleTurnUpdated(run, "cron");
    expect(store.getSnapshot().triggerKindByTurnId?.["run-1"]).toBe("cron");
  });

  it("indexes live turn items and keeps turn item ids unique", () => {
    const { store, handleTurnItemCreated } = createTurnsStore({
      turnList: async () => ({
        turns: [],
      }),
    } as never);

    const turnItemA = {
      turn_item_id: "11111111-2222-4333-8444-555555555555",
      turn_id: "run-1",
      item_index: 0,
      item_key: "message:user-1",
      kind: "message",
      created_at: "2026-03-13T12:00:00.000Z",
      payload: {
        message: {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
          metadata: { turn_id: "run-1" },
        },
      },
    } as const satisfies TurnItem;
    const turnItemB = {
      ...turnItemA,
      turn_item_id: "11111111-2222-4333-8444-666666666666",
      item_index: 1,
      item_key: "message:assistant-1",
      payload: {
        message: {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "done" }],
          metadata: { turn_id: "run-1" },
        },
      },
    } as const satisfies TurnItem;

    handleTurnItemCreated(turnItemA);
    handleTurnItemCreated(turnItemA);
    handleTurnItemCreated(turnItemB);

    expect(store.getSnapshot().turnItemsById[turnItemA.turn_item_id]).toEqual(turnItemA);
    expect(store.getSnapshot().turnItemIdsByTurnId["run-1"]).toEqual([
      turnItemA.turn_item_id,
      turnItemB.turn_item_id,
    ]);
  });
});
