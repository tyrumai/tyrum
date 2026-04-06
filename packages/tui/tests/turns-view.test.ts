import { describe, expect, it } from "vitest";
import { getTurnList } from "../src/turns-view.js";

describe("turns view helpers", () => {
  it("sorts turns by created_at desc", () => {
    const turnsState = {
      turnsById: {
        runA: {
          turn_id: "runA",
          job_id: "jobA",
          conversation_key: "conversation-a",
          status: "running",
          attempt: 1,
          created_at: "2024-01-01T00:00:00.000Z",
          started_at: null,
          finished_at: null,
        },
        runB: {
          turn_id: "runB",
          job_id: "jobB",
          conversation_key: "conversation-b",
          status: "queued",
          attempt: 1,
          created_at: "2024-02-01T00:00:00.000Z",
          started_at: null,
          finished_at: null,
        },
      },
    } as const;

    const turns = getTurnList(turnsState);
    expect(turns.map((turn) => turn.turn_id)).toEqual(["runB", "runA"]);
  });
});
