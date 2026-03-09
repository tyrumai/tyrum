import { AgentConfig, IdentityPack } from "@tyrum/schemas";
import { act } from "react";
import { vi } from "vitest";
import type { ActivityState } from "../../../operator-core/src/stores/activity-store.js";
import { createStore } from "../../../operator-core/src/store.js";

function createActivityState(overrides: Partial<ActivityState> = {}): ActivityState {
  return {
    agentsById: {},
    agentIds: [],
    workstreamsById: {},
    workstreamIds: [],
    selectedAgentId: null,
    selectedWorkstreamId: null,
    ...overrides,
  };
}

function createPersona(name: string) {
  return {
    name,
    description: `${name} operator persona`,
    tone: "direct" as const,
    palette: "graphite" as const,
    character: "operator" as const,
  };
}

function createWorkstream(
  overrides: Partial<ActivityState["workstreamsById"][string]> & {
    id: string;
    key: string;
    lane: string;
    agentId: string;
    currentRoom: NonNullable<ActivityState["workstreamsById"][string]>["currentRoom"];
  },
) {
  const persona = createPersona(overrides.agentId === "alpha" ? "Alpha" : "Beta");
  return {
    id: overrides.id,
    key: overrides.key,
    lane: overrides.lane,
    agentId: overrides.agentId,
    persona,
    latestRunId: overrides.latestRunId ?? null,
    runStatus: overrides.runStatus ?? null,
    queuedRunCount: overrides.queuedRunCount ?? 0,
    lease: overrides.lease ?? { owner: null, expiresAtMs: null, active: false },
    attentionLevel: overrides.attentionLevel ?? "low",
    attentionScore: overrides.attentionScore ?? 20,
    currentRoom: overrides.currentRoom,
    bubbleText: overrides.bubbleText ?? null,
    recentEvents: overrides.recentEvents ?? [],
  };
}

export function createSampleActivityState(): ActivityState {
  const main = createWorkstream({
    id: "agent:alpha:main::main",
    key: "agent:alpha:main",
    lane: "main",
    agentId: "alpha",
    latestRunId: "run-1",
    runStatus: "running",
    queuedRunCount: 1,
    lease: { owner: "Alpha", expiresAtMs: null, active: true },
    attentionLevel: "high",
    attentionScore: 78,
    currentRoom: "strategy-desk",
    bubbleText: "Planning the next move",
    recentEvents: [
      {
        id: "evt-1",
        type: "message.delta",
        occurredAt: "2026-03-09T09:00:00.000Z",
        summary: "Planning the next move",
      },
    ],
  });
  const review = createWorkstream({
    id: "agent:alpha:main::review",
    key: "agent:alpha:main",
    lane: "review",
    agentId: "alpha",
    latestRunId: "run-2",
    runStatus: "paused",
    attentionLevel: "medium",
    attentionScore: 42,
    currentRoom: "approval-desk",
    bubbleText: "Waiting for review",
    recentEvents: [
      {
        id: "evt-2",
        type: "approval.updated",
        occurredAt: "2026-03-09T09:05:00.000Z",
        summary: "Waiting for review",
      },
    ],
  });
  return {
    agentIds: ["alpha"],
    agentsById: {
      alpha: {
        agentId: "alpha",
        persona: createPersona("Alpha"),
        workstreamIds: [main.id, review.id],
        selectedWorkstreamId: main.id,
      },
    },
    workstreamIds: [main.id, review.id],
    selectedAgentId: "alpha",
    selectedWorkstreamId: main.id,
    workstreamsById: {
      [main.id]: main,
      [review.id]: review,
    },
  };
}

export function sampleManagedAgentDetail(agentKey: string) {
  return {
    agent_id: `${agentKey}-id`,
    agent_key: agentKey,
    created_at: "2026-03-08T00:00:00.000Z",
    updated_at: "2026-03-08T00:00:00.000Z",
    has_config: true,
    has_identity: true,
    can_delete: agentKey !== "default",
    persona: createPersona(agentKey === "alpha" ? "Alpha" : "Beta"),
    config: AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      persona: createPersona(agentKey === "alpha" ? "Alpha" : "Beta"),
    }),
    identity: IdentityPack.parse({
      meta: {
        name: agentKey === "alpha" ? "Alpha" : "Beta",
        description: `${agentKey} operator persona`,
        style: { tone: "direct" },
      },
      body: "",
    }),
  };
}

export function sampleAgentConfigUpdateResponse(agentKey: string) {
  return {
    revision: 2,
    tenant_id: "tenant-1",
    agent_id: `${agentKey}-id`,
    agent_key: agentKey,
    config: AgentConfig.parse({
      model: { model: "openai/gpt-5.4" },
      persona: createPersona(agentKey === "alpha" ? "Alpha" : "Beta"),
    }),
    persona: createPersona(agentKey === "alpha" ? "Alpha" : "Beta"),
    config_sha256: "a".repeat(64),
    created_at: "2026-03-09T09:10:00.000Z",
    created_by: { kind: "tenant.token", token_id: "token-1" },
    reason: "activity inspector persona update",
    reverted_from_revision: null,
  };
}

export function createCore(
  overrides: {
    activity?: Partial<ActivityState>;
    statusLoading?: boolean;
    getAgent?: ReturnType<typeof vi.fn>;
    updateAgentConfig?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const { store: statusStore } = createStore({
    status: null,
    usage: null,
    presenceByInstanceId: {},
    loading: {
      status: overrides.statusLoading ?? false,
      usage: false,
      presence: false,
    },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: null,
  });
  const activityState = createActivityState(overrides.activity);
  const activity = createStore(activityState);
  const activityStore = {
    ...activity.store,
    clearSelection() {
      activity.setState((prev) => ({ ...prev, selectedWorkstreamId: null }));
    },
    selectWorkstream(workstreamId: string | null) {
      activity.setState((prev) => ({ ...prev, selectedWorkstreamId: workstreamId }));
    },
  };

  return {
    activityStore,
    statusStore,
    http: {
      agents: {
        get: overrides.getAgent ?? vi.fn().mockResolvedValue(sampleManagedAgentDetail("alpha")),
      },
      agentConfig: {
        update:
          overrides.updateAgentConfig ??
          vi.fn().mockResolvedValue(sampleAgentConfigUpdateResponse("alpha")),
      },
    },
  };
}

export async function flushActivityPage(): Promise<void> {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
