import { describe, expect, it } from "vitest";
import type { Approval, AgentPersona, ExecutionRun } from "@tyrum/client";
import type { ApprovalsState, ChatState, StatusState } from "../src/index.js";
import { createStore } from "../src/store.js";
import { createActivityStore } from "../src/stores/activity-store.js";
import { createRunsStore } from "../src/stores/runs-store.js";

function samplePersona(name: string): AgentPersona {
  return {
    name,
    description: `${name} persona`,
    tone: "direct",
    palette: "graphite",
    character: "operator",
  };
}

function createApprovalsState(): ApprovalsState {
  return {
    byId: {},
    pendingIds: [],
    loading: false,
    error: null,
    lastSyncedAt: null,
  };
}

function createChatState(): ChatState {
  return {
    agentId: "default",
    agents: { agents: [], loading: false, error: null },
    sessions: { sessions: [], nextCursor: null, loading: false, error: null },
    active: { sessionId: null, session: null, loading: false, error: null },
    send: { sending: false, error: null },
  };
}

function createStatusState(): StatusState {
  return {
    status: null,
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: null,
  };
}

function sampleRun(input: Partial<ExecutionRun> & Pick<ExecutionRun, "run_id" | "key" | "lane">) {
  return {
    job_id: `job-${input.run_id}`,
    status: "running",
    attempt: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    started_at: "2026-01-01T00:00:01.000Z",
    finished_at: null,
    ...input,
  } satisfies ExecutionRun;
}

function sampleApproval(
  input: Partial<Approval> & Pick<Approval, "approval_id" | "approval_key" | "prompt" | "status">,
) {
  return {
    kind: "other",
    scope: undefined,
    created_at: "2026-01-01T00:00:00.000Z",
    resolution: null,
    ...input,
  } satisfies Approval;
}

function createHarness() {
  const runs = createRunsStore({
    runList: async () => ({ runs: [], steps: [], attempts: [] }),
  } as never);
  const approvals = createStore(createApprovalsState());
  const status = createStore(createStatusState());
  const chat = createStore(createChatState());
  const activity = createActivityStore({
    runsStore: runs.store,
    approvalsStore: approvals.store,
    statusStore: status.store,
    chatStore: chat.store,
  });

  return { runs, approvals, status, chat, activity };
}

describe("activityStore", () => {
  it("groups workstreams by agent while keeping key + lane identities distinct", () => {
    const { runs, activity } = createHarness();

    runs.handleRunUpdated(
      sampleRun({ run_id: "run-main", key: "agent:alpha:main", lane: "main", status: "running" }),
    );
    runs.handleRunUpdated(
      sampleRun({
        run_id: "run-subagent",
        key: "agent:alpha:main",
        lane: "subagent",
        status: "running",
        created_at: "2026-01-01T00:00:02.000Z",
      }),
    );
    runs.handleRunUpdated(
      sampleRun({
        run_id: "run-dm",
        key: "agent:alpha:dm:peer-1",
        lane: "main",
        status: "queued",
        created_at: "2026-01-01T00:00:03.000Z",
        started_at: null,
      }),
    );

    const snapshot = activity.store.getSnapshot();
    const alpha = snapshot.agentsById["alpha"];
    expect(alpha?.workstreamIds.toSorted()).toEqual([
      "agent:alpha:dm:peer-1::main",
      "agent:alpha:main::main",
      "agent:alpha:main::subagent",
    ]);
    expect(snapshot.workstreamsById["agent:alpha:main::main"]?.latestRunId).toBe("run-main");
    expect(snapshot.workstreamsById["agent:alpha:main::subagent"]?.latestRunId).toBe(
      "run-subagent",
    );
    expect(snapshot.workstreamsById["agent:alpha:dm:peer-1::main"]?.latestRunId).toBe("run-dm");
  });

  it("collapses multiple queued runs on one key + lane into one workstream with queue metadata", () => {
    const { runs, activity } = createHarness();

    runs.handleRunUpdated(
      sampleRun({
        run_id: "run-a",
        key: "agent:alpha:main",
        lane: "main",
        status: "queued",
        created_at: "2026-01-01T00:00:00.000Z",
        started_at: null,
      }),
    );
    runs.handleRunUpdated(
      sampleRun({
        run_id: "run-b",
        key: "agent:alpha:main",
        lane: "main",
        status: "queued",
        created_at: "2026-01-01T00:00:04.000Z",
        started_at: null,
      }),
    );

    const workstream = activity.store.getSnapshot().workstreamsById["agent:alpha:main::main"];
    expect(workstream?.queuedRunCount).toBe(2);
    expect(workstream?.latestRunId).toBe("run-b");
    expect(workstream?.runStatus).toBe("queued");
  });

  it("uses the full run comparator when selecting the latest run for a workstream", () => {
    const { runs, activity } = createHarness();

    runs.handleRunUpdated(
      sampleRun({
        run_id: "run-attempt-1",
        key: "agent:alpha:main",
        lane: "main",
        status: "paused",
        attempt: 1,
        created_at: "2026-01-01T00:00:04.000Z",
        paused_reason: "manual",
      }),
    );
    runs.handleRunUpdated(
      sampleRun({
        run_id: "run-attempt-2",
        key: "agent:alpha:main",
        lane: "main",
        status: "running",
        attempt: 2,
        created_at: "2026-01-01T00:00:04.000Z",
      }),
    );

    const workstream = activity.store.getSnapshot().workstreamsById["agent:alpha:main::main"];
    expect(workstream?.latestRunId).toBe("run-attempt-2");
    expect(workstream?.runStatus).toBe("running");
  });

  it("uses approval, failure, then paused precedence for attention and default selection", () => {
    const { runs, approvals, activity } = createHarness();

    runs.handleRunUpdated(
      sampleRun({
        run_id: "run-failed",
        key: "agent:beta:main",
        lane: "main",
        status: "failed",
        created_at: "2026-01-01T00:00:01.000Z",
        started_at: "2026-01-01T00:00:02.000Z",
        finished_at: "2026-01-01T00:00:04.000Z",
      }),
    );
    runs.handleRunUpdated(
      sampleRun({
        run_id: "run-paused",
        key: "agent:gamma:main",
        lane: "main",
        status: "paused",
        paused_reason: "manual",
        paused_detail: "Waiting on operator",
        created_at: "2026-01-01T00:00:02.000Z",
      }),
    );
    approvals.setState((prev) => ({
      ...prev,
      byId: {
        "approval-1": sampleApproval({
          approval_id: "approval-1",
          approval_key: "approval-1",
          prompt: "Review before proceeding",
          status: "pending",
          scope: { key: "agent:alpha:main", lane: "main" },
        }),
      },
      pendingIds: ["approval-1"],
    }));

    const snapshot = activity.store.getSnapshot();
    expect(snapshot.workstreamIds.slice(0, 3)).toEqual([
      "agent:alpha:main::main",
      "agent:beta:main::main",
      "agent:gamma:main::main",
    ]);
    expect(snapshot.selectedWorkstreamId).toBe("agent:alpha:main::main");
    expect(snapshot.workstreamsById["agent:alpha:main::main"]?.attentionLevel).toBe("critical");
    expect(snapshot.workstreamsById["agent:beta:main::main"]?.attentionLevel).toBe("high");
    expect(snapshot.workstreamsById["agent:gamma:main::main"]?.attentionLevel).toBe("medium");
  });

  it("uses fine-grained priority scores to order workstreams within the same attention level", () => {
    const { runs, activity } = createHarness();

    runs.handleRunUpdated(
      sampleRun({
        run_id: "run-paused",
        key: "agent:alpha:main",
        lane: "main",
        status: "paused",
        paused_reason: "manual",
        created_at: "2026-01-01T00:00:01.000Z",
      }),
    );
    runs.handleRunUpdated(
      sampleRun({
        run_id: "run-running",
        key: "agent:gamma:main",
        lane: "main",
        status: "running",
        created_at: "2026-01-01T00:00:06.000Z",
        started_at: "2026-01-01T00:00:06.000Z",
      }),
    );
    activity.handleMessageDelta({
      sessionId: "agent:beta:main",
      lane: "main",
      messageId: "message-1",
      role: "assistant",
      delta: "Latest message wins on time only",
      occurredAt: "2026-01-01T00:00:07.000Z",
    });

    const snapshot = activity.store.getSnapshot();
    expect(snapshot.workstreamIds.slice(0, 3)).toEqual([
      "agent:alpha:main::main",
      "agent:beta:main::main",
      "agent:gamma:main::main",
    ]);
    expect(snapshot.workstreamsById["agent:alpha:main::main"]?.attentionScore).toBe(700);
    expect(snapshot.workstreamsById["agent:beta:main::main"]?.attentionScore).toBe(650);
    expect(snapshot.workstreamsById["agent:gamma:main::main"]?.attentionScore).toBe(600);
  });

  it("falls back to session_lanes data when no run events have arrived", () => {
    const { status, chat, activity } = createHarness();

    chat.setState((prev) => ({
      ...prev,
      agents: {
        agents: [{ agent_id: "alpha", persona: samplePersona("Hypatia") }],
        loading: false,
        error: null,
      },
    }));
    status.setState((prev) => ({
      ...prev,
      status: {
        status: "ok",
        version: "0.1.0",
        instance_id: "gateway-1",
        role: "gateway",
        db_kind: "sqlite",
        is_exposed: false,
        otel_enabled: false,
        auth: { enabled: true },
        ws: null,
        policy: null,
        model_auth: null,
        catalog_freshness: null,
        queue_depth: null,
        sandbox: null,
        config_health: { status: "ok", issues: [] },
        session_lanes: [
          {
            key: "agent:alpha:main",
            lane: "main",
            latest_run_id: "run-status-only",
            latest_run_status: "paused",
            queued_runs: 3,
            lease_owner: "worker-1",
            lease_expires_at_ms: 1_800_000_000_000,
            lease_active: true,
          },
        ],
      } as StatusState["status"],
    }));

    const workstream = activity.store.getSnapshot().workstreamsById["agent:alpha:main::main"];
    expect(workstream).toMatchObject({
      latestRunId: "run-status-only",
      runStatus: "paused",
      queuedRunCount: 3,
      currentRoom: "strategy-desk",
      persona: samplePersona("Hypatia"),
    });
    expect(workstream?.lease).toEqual({
      owner: "worker-1",
      expiresAtMs: 1_800_000_000_000,
      active: true,
    });
  });

  it("records message activity on the matching key + lane workstream", () => {
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
    const workstream = activity.store.getSnapshot().workstreamsById["agent:alpha:main::main"];
    expect(workstream?.currentRoom).toBe("mail-room");
    expect(workstream?.bubbleText).toBe("Drafting plan");
    expect(workstream?.recentEvents.map((event) => event.type)).toEqual([
      "message.delta",
      "typing.started",
    ]);
  });

  it("falls through to message bubble text when a paused run has no pause detail", () => {
    const { runs, activity } = createHarness();

    runs.handleRunUpdated(
      sampleRun({
        run_id: "run-paused",
        key: "agent:alpha:main",
        lane: "main",
        status: "paused",
        paused_reason: "   ",
        paused_detail: null,
      }),
    );
    activity.handleMessageDelta({
      sessionId: "agent:alpha:main",
      lane: "main",
      messageId: "message-1",
      role: "assistant",
      delta: "Drafting plan",
      occurredAt: "2026-01-01T00:00:02.000Z",
    });

    const workstream = activity.store.getSnapshot().workstreamsById["agent:alpha:main::main"];
    expect(workstream?.bubbleText).toBe("Drafting plan");
  });

  it("uses a neutral delivery summary when the receipt status is unknown", () => {
    const { activity } = createHarness();

    activity.handleDeliveryReceipt({
      sessionId: "agent:alpha:main",
      lane: "main",
      channel: "email",
      threadId: "thread-1",
      status: null,
      occurredAt: "2026-01-01T00:00:02.000Z",
    });

    const workstream = activity.store.getSnapshot().workstreamsById["agent:alpha:main::main"];
    expect(workstream?.currentRoom).toBe("mail-room");
    expect(workstream?.recentEvents[0]?.type).toBe("delivery.receipt");
    expect(workstream?.recentEvents[0]?.summary).toBe("Delivery receipt");
  });
});
