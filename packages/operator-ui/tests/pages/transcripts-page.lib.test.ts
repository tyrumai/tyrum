import { describe, expect, it } from "vitest";
import { buildConversationTreeEntries } from "../../src/components/pages/transcripts-page.lib.js";

function createSession(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: "session-root-id",
    conversation_key: "session-root",
    agent_key: "default",
    channel: "ui",
    thread_id: "thread-root",
    title: "Root session",
    message_count: 2,
    updated_at: "2026-03-13T12:00:00.000Z",
    created_at: "2026-03-13T11:00:00.000Z",
    archived: false,
    latest_turn_id: null,
    latest_turn_status: null,
    has_active_turn: false,
    pending_approval_count: 0,
    ...overrides,
  };
}

describe("buildConversationTreeEntries", () => {
  it("returns all conversations even when lineage data contains a cycle", () => {
    const entries = buildConversationTreeEntries([
      createSession({
        conversation_id: "session-a-id",
        conversation_key: "session-a",
        parent_conversation_key: "session-b",
      }),
      createSession({
        conversation_id: "session-b-id",
        conversation_key: "session-b",
        parent_conversation_key: "session-a",
      }),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.session.conversation_key).toSorted()).toEqual([
      "session-a",
      "session-b",
    ]);
  });
});
