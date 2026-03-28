import { describe, expect, it } from "vitest";
import {
  buildChildConversationEntries,
  buildChildConversationsByParentKey,
  buildRootConversationsByAgent,
} from "../../src/components/pages/agents-page.lib.js";

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

describe("buildRootConversationsByAgent", () => {
  it("sorts root conversations by updated time descending", () => {
    const rootsByAgent = buildRootConversationsByAgent([
      createConversation({
        conversation_key: "conversation-older",
        updated_at: "2026-03-13T12:00:00.000Z",
      }),
      createConversation({
        conversation_key: "conversation-newer",
        updated_at: "2026-03-13T13:00:00.000Z",
      }),
    ]);

    expect(
      rootsByAgent.get("default")?.map((conversation) => conversation.conversation_key),
    ).toEqual(["conversation-newer", "conversation-older"]);
  });
});

describe("buildChildConversationEntries", () => {
  it("returns child conversations once even when lineage data contains a cycle", () => {
    const conversations = [
      createConversation({
        conversation_id: "conversation-root-id",
        conversation_key: "conversation-root",
        parent_conversation_key: "conversation-b",
      }),
      createConversation({
        conversation_id: "conversation-a-id",
        conversation_key: "conversation-a",
        parent_conversation_key: "conversation-root",
        created_at: "2026-03-13T11:10:00.000Z",
      }),
      createConversation({
        conversation_id: "conversation-b-id",
        conversation_key: "conversation-b",
        parent_conversation_key: "conversation-a",
        created_at: "2026-03-13T11:20:00.000Z",
      }),
    ];
    const conversationsByKey = new Map(
      conversations.map((conversation) => [conversation.conversation_key, conversation]),
    );
    const childrenByParentKey = buildChildConversationsByParentKey(conversationsByKey);

    const entries = buildChildConversationEntries({
      rootConversationKey: "conversation-root",
      childrenByParentKey,
    });

    expect(entries.map((entry) => entry.conversation.conversation_key)).toEqual([
      "conversation-a",
      "conversation-b",
    ]);
    expect(entries.map((entry) => entry.depth)).toEqual([1, 2]);
  });
});
