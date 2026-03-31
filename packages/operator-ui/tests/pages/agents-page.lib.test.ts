import { describe, expect, it } from "vitest";
import {
  buildAgentTurnRows,
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

describe("buildAgentTurnRows", () => {
  it("groups turn-linked messages and approvals under their turn", () => {
    const turnId = "turn-1";
    const rows = buildAgentTurnRows([
      {
        event_id: "turn:1",
        kind: "turn",
        occurred_at: "2026-03-13T11:01:00.000Z",
        conversation_key: "conversation-root",
        payload: {
          turn: {
            turn_id: turnId,
            job_id: "job-1",
            conversation_key: "conversation-root",
            status: "running",
            attempt: 1,
            created_at: "2026-03-13T11:01:00.000Z",
            started_at: "2026-03-13T11:01:01.000Z",
            finished_at: null,
          },
          steps: [],
          attempts: [],
        },
      },
      {
        event_id: "message:1",
        kind: "message",
        occurred_at: "2026-03-13T11:01:02.000Z",
        conversation_key: "conversation-root",
        payload: {
          message: {
            id: "message-1",
            role: "assistant",
            parts: [
              { type: "text", text: "Working on it" },
              { type: "tool-websearch", toolName: "websearch", state: "output-available" },
            ],
            metadata: {
              turn_id: turnId,
            },
          },
        },
      },
      {
        event_id: "approval:1",
        kind: "approval",
        occurred_at: "2026-03-13T11:01:03.000Z",
        conversation_key: "conversation-root",
        payload: {
          approval: {
            approval_id: "approval-1",
            approval_key: "approval-key-1",
            agent_id: "default",
            kind: "policy",
            status: "queued",
            prompt: "Approve this action",
            motivation: "Approve this action",
            scope: {
              turn_id: turnId,
            },
            created_at: "2026-03-13T11:01:03.000Z",
            expires_at: null,
            latest_review: null,
          },
        },
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.items.map((item) => item.kind)).toEqual(["message", "tool", "approval"]);
    expect(rows[0]?.items.map((item) => item.summary)).toEqual([
      "Working on it",
      "websearch (output available)",
      "Approve this action",
    ]);
  });
});
