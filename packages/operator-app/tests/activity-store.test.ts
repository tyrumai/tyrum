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
    sessions: { sessions: [], nextCursor: null, loading: false, error: null },
    archivedSessions: {
      sessions: [],
      nextCursor: null,
      loading: false,
      loaded: false,
      error: null,
    },
    active: { sessionId: null, session: null, loading: false, error: null },
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
      sessions: {
        sessions: [
          {
            session_id: "session-1",
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

  it("groups ephemeral workstreams by agent while keeping key + lane identities distinct", () => {
    const { activity } = createHarness();

    activity.handleTypingStarted({
      sessionId: "agent:alpha:main",
      lane: "main",
      occurredAt: "2026-01-01T00:00:01.000Z",
    });
    activity.handleMessageFinal({
      sessionId: "agent:alpha:main",
      lane: "subagent",
      messageId: "message-subagent",
      role: "assistant",
      content: "Delegated reply",
      occurredAt: "2026-01-01T00:00:02.000Z",
    });
    activity.handleDeliveryReceipt({
      sessionId: "agent:alpha:dm:peer-1",
      lane: "main",
      channel: "email",
      threadId: "thread-1",
      status: "sent",
      occurredAt: "2026-01-01T00:00:03.000Z",
    });

    const snapshot = activity.store.getSnapshot();
    expect(snapshot.agentsById["alpha"]?.workstreamIds.toSorted()).toEqual([
      "agent:alpha:dm:peer-1::main",
      "agent:alpha:main::main",
      "agent:alpha:main::subagent",
    ]);
  });

  it("uses chat session lookups to attach personas for non-key session ids", () => {
    const { chat, activity } = createHarness();

    chat.setState((prev) => ({
      ...prev,
      agents: {
        agents: [{ agent_key: "alpha", persona: samplePersona("Hypatia") }],
        loading: false,
        error: null,
      },
      sessions: {
        sessions: [
          {
            session_id: "session-1",
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
      sessionId: "session-1",
      lane: "main",
      messageId: "message-1",
      role: "assistant",
      delta: "Drafting plan",
      occurredAt: "2026-01-01T00:00:02.000Z",
    });

    const workstream = activity.store.getSnapshot().workstreamsById["session-1::main"];
    expect(workstream?.agentId).toBe("alpha");
    expect(workstream?.persona).toEqual(samplePersona("Hypatia"));
  });

  it("derives attention, room, bubble text, and ordering from message activity only", () => {
    const { activity } = createHarness();

    activity.handleTypingStarted({
      sessionId: "agent:alpha:main",
      lane: "main",
      occurredAt: "2026-01-01T00:00:01.000Z",
    });
    activity.handleMessageDelta({
      sessionId: "agent:alpha:main",
      lane: "main",
      messageId: "message-1",
      role: "assistant",
      delta: "Drafting plan",
      occurredAt: "2026-01-01T00:00:02.000Z",
    });
    activity.handleMessageFinal({
      sessionId: "agent:beta:main",
      lane: "main",
      messageId: "message-2",
      role: "assistant",
      content: "More recent update",
      occurredAt: "2026-01-01T00:00:03.000Z",
    });

    const snapshot = activity.store.getSnapshot();
    expect(snapshot.workstreamIds.slice(0, 2)).toEqual([
      "agent:beta:main::main",
      "agent:alpha:main::main",
    ]);
    expect(snapshot.selectedWorkstreamId).toBe("agent:beta:main::main");
    expect(snapshot.workstreamsById["agent:alpha:main::main"]).toMatchObject({
      latestRunId: null,
      runStatus: null,
      queuedRunCount: 0,
      lease: { owner: null, expiresAtMs: null, active: false },
      attentionLevel: "medium",
      attentionScore: 650,
      currentRoom: "mail-room",
      bubbleText: "Drafting plan",
    });
    expect(
      snapshot.workstreamsById["agent:alpha:main::main"]?.recentEvents.map((event) => event.type),
    ).toEqual(["message.delta", "typing.started"]);
  });

  it("supports explicit selection and neutral delivery summaries", () => {
    const { activity } = createHarness();

    activity.handleDeliveryReceipt({
      sessionId: "agent:alpha:main",
      lane: "main",
      channel: "email",
      threadId: "thread-1",
      status: null,
      occurredAt: "2026-01-01T00:00:02.000Z",
    });
    activity.handleMessageFinal({
      sessionId: "agent:beta:main",
      lane: "main",
      messageId: "message-2",
      role: "assistant",
      content: "Newest message",
      occurredAt: "2026-01-01T00:00:03.000Z",
    });

    activity.store.selectWorkstream("agent:alpha:main::main");
    let snapshot = activity.store.getSnapshot();
    expect(snapshot.selectedWorkstreamId).toBe("agent:alpha:main::main");
    expect(snapshot.selectedAgentId).toBe("alpha");
    expect(snapshot.workstreamsById["agent:alpha:main::main"]?.recentEvents[0]).toMatchObject({
      type: "delivery.receipt",
      summary: "Delivery receipt",
    });

    activity.store.clearSelection();
    snapshot = activity.store.getSnapshot();
    expect(snapshot.selectedWorkstreamId).toBe("agent:beta:main::main");
    expect(snapshot.selectedAgentId).toBe("beta");
  });
});
