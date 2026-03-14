import { describe, expect, it } from "vitest";
import type { CheckpointSummary } from "@tyrum/schemas";
import { buildDeterministicFallbackCheckpoint } from "../../src/modules/agent/runtime/session-compaction-fallback.js";

function createCheckpointSummary(goal: string): CheckpointSummary {
  return {
    goal,
    user_constraints: [],
    decisions: [],
    discoveries: [],
    completed_work: [],
    pending_work: [],
    unresolved_questions: [],
    critical_identifiers: [],
    relevant_files: [],
    handoff_md: "",
  };
}

describe("buildDeterministicFallbackCheckpoint", () => {
  it("keeps truncated goals within the maximum summary line length", () => {
    const checkpoint = buildDeterministicFallbackCheckpoint({
      previousCheckpoint: createCheckpointSummary("x".repeat(400)),
      droppedMessages: [],
      criticalIdentifiers: [],
      relevantFiles: [],
    });

    expect(checkpoint.goal).toHaveLength(240);
    expect(checkpoint.goal).toBe(`${"x".repeat(237)}...`);
  });
});
