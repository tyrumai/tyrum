import { describe, expect, it } from "vitest";

import {
  collectActiveAgentKeys,
  countActiveTurns,
  parseAgentKeyFromConversationKey,
  resolveAgentKeyForTurn,
} from "../../src/lib/conversation-turn-activity.js";

describe("conversation-turn-activity", () => {
  it("parses agent keys from agent conversation keys", () => {
    expect(parseAgentKeyFromConversationKey("agent:default:ui:main")).toBe("default");
    expect(parseAgentKeyFromConversationKey("agent:secondary:ui")).toBe("secondary");
    expect(parseAgentKeyFromConversationKey("agent:default:")).toBe("default");

    expect(parseAgentKeyFromConversationKey("agent::ui")).toBeNull();
    expect(parseAgentKeyFromConversationKey("agent:default")).toBeNull();
    expect(parseAgentKeyFromConversationKey("not-agent")).toBeNull();
  });

  it("resolves turn agent keys from explicit mappings before parsing the conversation key", () => {
    expect(
      resolveAgentKeyForTurn(
        { turn_id: "turn-1", conversation_key: "agent:default:ui:main" },
        { "turn-1": "mapped-agent" },
      ),
    ).toBe("mapped-agent");
    expect(
      resolveAgentKeyForTurn({ turn_id: "turn-2", conversation_key: "agent:default:ui:main" }),
    ).toBe("default");
    expect(resolveAgentKeyForTurn({ turn_id: "turn-3", conversation_key: "not-agent" })).toBeNull();
  });

  it("collects active agent keys from conversation summaries and active turns", () => {
    const ids = collectActiveAgentKeys({
      transcriptConversations: [
        {
          conversation_id: "conversation-1",
          conversation_key: "agent:default:ui:main",
          agent_key: "default",
          channel: "ui",
          thread_id: "main",
          title: "Main",
          message_count: 2,
          updated_at: "2026-03-27T10:00:00.000Z",
          created_at: "2026-03-27T09:00:00.000Z",
          archived: false,
          latest_turn_id: "turn-1",
          latest_turn_status: "running",
          has_active_turn: true,
          pending_approval_count: 0,
        },
      ],
      turnsState: {
        turnsById: {
          "turn-2": {
            turn_id: "turn-2",
            job_id: "job-2",
            conversation_key: "agent:secondary:ui:main",
            status: "paused",
            attempt: 1,
            created_at: "2026-03-27T10:01:00.000Z",
            started_at: "2026-03-27T10:01:01.000Z",
            finished_at: null,
          },
        },
        agentKeyByTurnId: { "turn-2": "secondary" },
      },
    });

    expect(Array.from(ids).toSorted()).toEqual(["default", "secondary"]);
  });

  it("counts active turns without double-counting the same latest turn", () => {
    expect(
      countActiveTurns({
        transcriptConversations: [
          {
            conversation_id: "conversation-1",
            conversation_key: "agent:default:ui:main",
            agent_key: "default",
            channel: "ui",
            thread_id: "main",
            title: "Main",
            message_count: 2,
            updated_at: "2026-03-27T10:00:00.000Z",
            created_at: "2026-03-27T09:00:00.000Z",
            archived: false,
            latest_turn_id: "turn-1",
            latest_turn_status: "running",
            has_active_turn: true,
            pending_approval_count: 0,
          },
          {
            conversation_id: "conversation-2",
            conversation_key: "agent:helper:ui:main",
            agent_key: "helper",
            channel: "ui",
            thread_id: "helper",
            title: "Helper",
            message_count: 1,
            updated_at: "2026-03-27T10:02:00.000Z",
            created_at: "2026-03-27T10:01:00.000Z",
            archived: false,
            latest_turn_id: null,
            latest_turn_status: "queued",
            has_active_turn: true,
            pending_approval_count: 0,
          },
        ],
        turnsState: {
          turnsById: {
            "turn-1": {
              turn_id: "turn-1",
              job_id: "job-1",
              conversation_key: "agent:default:ui:main",
              status: "running",
              attempt: 1,
              created_at: "2026-03-27T10:00:00.000Z",
              started_at: "2026-03-27T10:00:01.000Z",
              finished_at: null,
            },
            "turn-2": {
              turn_id: "turn-2",
              job_id: "job-2",
              conversation_key: "agent:secondary:ui:main",
              status: "paused",
              attempt: 1,
              created_at: "2026-03-27T10:03:00.000Z",
              started_at: "2026-03-27T10:03:01.000Z",
              finished_at: null,
            },
          },
        },
      }),
    ).toBe(3);
  });
});
