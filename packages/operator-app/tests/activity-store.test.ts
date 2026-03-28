import { describe, expect, it } from "vitest";
import type { AgentPersona } from "@tyrum/contracts";
import type { ChatState } from "../src/index.js";
import { createStore } from "../src/store.js";
import { createActivityStore } from "../src/stores/activity-store.js";

function samplePersona(name: string): AgentPersona {
  return {
    name,
    description: `${name} persona`,
    tone: "direct",
    palette: "graphite",
    character: "operator",
  };
}

function createChatState(): ChatState {
  return {
    agentKey: "default",
    agents: { agents: [], loading: false, error: null },
    conversations: { conversations: [], nextCursor: null, loading: false, error: null },
    archivedConversations: {
      conversations: [],
      nextCursor: null,
      loading: false,
      loaded: false,
      error: null,
    },
    active: { conversationId: null, conversation: null, loading: false, error: null },
  };
}

function createHarness() {
  const chat = createStore(createChatState());
  const activity = createActivityStore({
    chatStore: chat.store,
  });

  return { chat, activity };
}

describe("activityStore", () => {
  it("only creates workstreams from ephemeral message activity", () => {
    const { chat, activity } = createHarness();

    chat.setState((prev) => ({
      ...prev,
      agents: {
        agents: [{ agent_key: "alpha", persona: samplePersona("Hypatia") }],
        loading: false,
        error: null,
      },
      conversations: {
        conversations: [
          {
            conversation_id: "conversation-1",
            agent_key: "alpha",
            channel: "ui",
            thread_id: "thread-1",
            title: "Active chat",
            message_count: 2,
            updated_at: "2026-01-01T00:00:00.000Z",
            created_at: "2026-01-01T00:00:00.000Z",
            archived: false,
          },
        ],
        nextCursor: null,
        loading: false,
        error: null,
      },
    }));

    expect(activity.store.getSnapshot()).toMatchObject({
      agentIds: [],
      workstreamIds: [],
      selectedAgentId: null,
      selectedWorkstreamId: null,
    });
  });

  it("groups ephemeral workstreams by conversation identity and thread fallback", () => {
    const { activity } = createHarness();

    activity.handleTypingStarted({
      conversationId: "agent:alpha:main",
      occurredAt: "2026-01-01T00:00:01.000Z",
    });
    activity.handleMessageFinal({
      conversationId: "agent:alpha:main",
      threadId: "thread-main",
      messageId: "message-main",
      role: "assistant",
      content: "Delegated reply",
      occurredAt: "2026-01-01T00:00:02.000Z",
    });
    activity.handleDeliveryReceipt({
      threadId: "thread-1",
      channel: "email",
      status: "sent",
      occurredAt: "2026-01-01T00:00:03.000Z",
    });

    const snapshot = activity.store.getSnapshot();
    expect(snapshot.agentsById["alpha"]?.workstreamIds).toEqual(["agent:alpha:main"]);
    expect(snapshot.workstreamIds.toSorted()).toEqual(["agent:alpha:main", "thread-1"]);
  });

  it("uses chat conversation lookups to attach personas for non-key conversation ids", () => {
    const { chat, activity } = createHarness();

    chat.setState((prev) => ({
      ...prev,
      agents: {
        agents: [{ agent_key: "alpha", persona: samplePersona("Hypatia") }],
        loading: false,
        error: null,
      },
      conversations: {
        conversations: [
          {
            conversation_id: "conversation-1",
            agent_key: "alpha",
            channel: "ui",
            thread_id: "thread-1",
            title: "Mapped chat",
            message_count: 1,
            updated_at: "2026-01-01T00:00:00.000Z",
            created_at: "2026-01-01T00:00:00.000Z",
            archived: false,
          },
        ],
        nextCursor: null,
        loading: false,
        error: null,
      },
    }));

    activity.handleMessageDelta({
      conversationId: "conversation-1",
      threadId: "thread-1",
      messageId: "message-1",
      role: "assistant",
      delta: "Drafting plan",
      occurredAt: "2026-01-01T00:00:02.000Z",
    });

    const workstream = activity.store.getSnapshot().workstreamsById["conversation-1"];
    expect(workstream?.agentId).toBe("alpha");
    expect(workstream?.persona).toEqual(samplePersona("Hypatia"));
  });

  it("derives attention, room, bubble text, and ordering from message activity only", () => {
    const { activity } = createHarness();

    activity.handleTypingStarted({
      conversationId: "agent:alpha:main",
      occurredAt: "2026-01-01T00:00:01.000Z",
    });
    activity.handleMessageDelta({
      conversationId: "agent:alpha:main",
      messageId: "message-1",
      role: "assistant",
      delta: "Drafting plan",
      occurredAt: "2026-01-01T00:00:02.000Z",
    });
    activity.handleMessageFinal({
      conversationId: "agent:beta:main",
      messageId: "message-2",
      role: "assistant",
      content: "More recent update",
      occurredAt: "2026-01-01T00:00:03.000Z",
    });

    const snapshot = activity.store.getSnapshot();
    expect(snapshot.workstreamIds.slice(0, 2)).toEqual(["agent:beta:main", "agent:alpha:main"]);
    expect(snapshot.selectedWorkstreamId).toBe("agent:beta:main");
    expect(snapshot.workstreamsById["agent:alpha:main"]).toMatchObject({
      latestTurnId: null,
      turnStatus: null,
      queuedTurnCount: 0,
      lease: { owner: null, expiresAtMs: null, active: false },
      attentionLevel: "medium",
      attentionScore: 650,
      currentRoom: "mail-room",
      bubbleText: "Drafting plan",
    });
    expect(
      snapshot.workstreamsById["agent:alpha:main"]?.recentEvents.map((event) => event.type),
    ).toEqual(["message.delta", "typing.started"]);
  });

  it("supports explicit selection and neutral delivery summaries", () => {
    const { activity } = createHarness();

    activity.handleDeliveryReceipt({
      conversationId: "agent:alpha:main",
      threadId: "thread-1",
      channel: "email",
      status: null,
      occurredAt: "2026-01-01T00:00:02.000Z",
    });
    activity.handleMessageFinal({
      conversationId: "agent:beta:main",
      messageId: "message-2",
      role: "assistant",
      content: "Newest message",
      occurredAt: "2026-01-01T00:00:03.000Z",
    });

    activity.store.selectWorkstream("agent:alpha:main");
    let snapshot = activity.store.getSnapshot();
    expect(snapshot.selectedWorkstreamId).toBe("agent:alpha:main");
    expect(snapshot.selectedAgentId).toBe("alpha");
    expect(snapshot.workstreamsById["agent:alpha:main"]?.recentEvents[0]).toMatchObject({
      type: "delivery.receipt",
      summary: "Delivery receipt",
    });

    activity.store.clearSelection();
    snapshot = activity.store.getSnapshot();
    expect(snapshot.selectedWorkstreamId).toBe("agent:beta:main");
    expect(snapshot.selectedAgentId).toBe("beta");
  });
});
