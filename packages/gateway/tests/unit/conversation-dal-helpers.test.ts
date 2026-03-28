import { describe, expect, it } from "vitest";
import {
  buildConversationSelectSql,
  normalizeConversationTitle,
  parseContextState,
} from "../../src/modules/agent/conversation-dal-helpers.js";

describe("normalizeConversationTitle", () => {
  it("rejects low-signal generic titles", () => {
    expect(normalizeConversationTitle("Need help")).toBe("");
    expect(normalizeConversationTitle("Question")).toBe("");
    expect(normalizeConversationTitle("New conversation")).toBe("");
  });

  it("keeps specific titles intact", () => {
    expect(normalizeConversationTitle("Debug guardian review prompt drift")).toBe(
      "Debug guardian review prompt drift",
    );
  });
});

describe("conversation state hydration", () => {
  it("normalizes Postgres-style timestamps before conversation-state validation", () => {
    const state = parseContextState(
      JSON.stringify({
        version: 1,
        recent_message_ids: [],
        checkpoint: {
          goal: "retain compacted state",
          user_constraints: [],
          decisions: [],
          discoveries: [],
          completed_work: [],
          pending_work: ["resume after reload"],
          unresolved_questions: [],
          critical_identifiers: [],
          relevant_files: [],
          handoff_md: "checkpoint survives readback",
        },
        pending_approvals: [],
        pending_tool_state: [
          {
            summary: "tool still pending",
            tool_call_id: "tool-call-1",
            tool_name: "shell",
          },
        ],
        updated_at: "2026-03-19 09:00:00+00",
      }),
      {},
      "2026-03-19T09:00:00.000Z",
    );

    expect(state.updated_at).toBe("2026-03-19T09:00:00.000Z");
    expect(state.checkpoint?.handoff_md).toBe("checkpoint survives readback");
    expect(state.pending_tool_state).toEqual([
      {
        summary: "tool still pending",
        tool_call_id: "tool-call-1",
        tool_name: "shell",
      },
    ]);
  });

  it("emits ISO updated_at in the Postgres conversation-state projection", () => {
    const sql = buildConversationSelectSql("postgres");

    expect(sql).toContain("to_char(");
    expect(sql).toContain('\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\'');
    expect(sql).not.toContain("cs.updated_at::text");
  });
});
