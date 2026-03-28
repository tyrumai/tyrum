import { describe, expect, it } from "vitest";
import {
  toConversationListRow,
  type RawConversationListRow,
} from "../../src/modules/agent/conversation-dal-helpers.js";

function rawConversationListRow(messagesJson: string): RawConversationListRow {
  return {
    conversation_id: "conversation-1",
    conversation_key: "conversation-key-1",
    agent_key: "agent-1",
    connector_key: "ui",
    provider_thread_id: "thread-1",
    title: "",
    messages_json: messagesJson,
    context_state_json:
      '{"version":1,"recent_message_ids":[],"checkpoint":null,"pending_approvals":[],"pending_tool_state":[],"updated_at":"2026-03-09T00:00:00.000Z"}',
    created_at: "2026-03-09T00:00:00.000Z",
    updated_at: "2026-03-09T00:00:00.000Z",
  };
}

describe("toConversationListRow", () => {
  it("derives message previews from UI messages", () => {
    const row = toConversationListRow(
      rawConversationListRow(
        JSON.stringify([
          { id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] },
          { id: "m2", role: "assistant", parts: [{ type: "text", text: "world" }] },
        ]),
      ),
      {},
    );

    expect(row.message_count).toBe(2);
    expect(row.last_message).toEqual({ role: "assistant", content: "world" });
  });
});
