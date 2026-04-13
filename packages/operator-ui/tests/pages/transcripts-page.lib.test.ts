import { describe, expect, it } from "vitest";
import {
  buildConversationTreeEntries,
  buildInspectorFields,
} from "../../src/components/pages/transcripts-page.lib.js";

function createConversation(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: "conversation-root-id",
    conversation_key: "conversation-root",
    agent_key: "default",
    channel: "ui",
    thread_id: "thread-root",
    title: "Root conversation",
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
      createConversation({
        conversation_id: "conversation-a-id",
        conversation_key: "conversation-a",
        parent_conversation_key: "conversation-b",
      }),
      createConversation({
        conversation_id: "conversation-b-id",
        conversation_key: "conversation-b",
        parent_conversation_key: "conversation-a",
      }),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.conversation.conversation_key).toSorted()).toEqual([
      "conversation-a",
      "conversation-b",
    ]);
  });
});

describe("buildInspectorFields", () => {
  it("renders canonical tool IDs from transcript payloads without remapping", () => {
    const fields = buildInspectorFields(
      {
        event_id: "tool-event-1",
        kind: "tool_lifecycle",
        occurred_at: "2026-03-13T12:00:00.000Z",
        conversation_key: "conversation-root",
        payload: {
          tool_event: {
            conversation_id: "conversation-root-id",
            thread_id: "thread-root",
            tool_call_id: "tool-call-1",
            tool_id: "memory.write",
            status: "completed",
            summary: "Saved a durable memory.",
            agent_id: "default",
            workspace_id: "default",
            channel: "ui",
          },
        },
      },
      null,
    );

    expect(fields).toContainEqual({ label: "Tool", value: "memory.write" });
  });
});
