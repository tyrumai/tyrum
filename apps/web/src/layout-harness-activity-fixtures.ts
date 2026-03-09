import type {
  ActivityAgent,
  ActivityState,
  ActivityStore,
  ActivityWorkstream,
} from "../../../packages/operator-core/src/stores/activity-store.js";
import { createStore } from "../../../packages/operator-core/src/store.js";

function makeWorkstream(
  overrides: Partial<ActivityWorkstream> &
    Pick<ActivityWorkstream, "id" | "key" | "lane" | "agentId">,
): ActivityWorkstream {
  return {
    latestRunId: null,
    runStatus: null,
    queuedRunCount: 0,
    lease: { owner: null, expiresAtMs: null, active: false },
    attentionLevel: "idle",
    attentionScore: 100,
    currentRoom: "lounge",
    bubbleText: null,
    recentEvents: [],
    persona: {
      name: "Agent",
      description: "Default agent",
      tone: "direct",
      palette: "graphite",
      character: "operator",
    },
    ...overrides,
  };
}

export function createActivityFixtureStore(): ActivityStore {
  const ws1 = makeWorkstream({
    id: "agent:default:main::main",
    key: "agent:default:main",
    lane: "main",
    agentId: "default",
    persona: {
      name: "Atlas",
      description: "Primary operator",
      tone: "direct",
      palette: "moss",
      character: "operator",
    },
    latestRunId: "run-1",
    runStatus: "running",
    queuedRunCount: 0,
    attentionLevel: "medium",
    attentionScore: 600,
    currentRoom: "terminal-lab",
    bubbleText: "Building workspace layout...",
    recentEvents: [
      {
        id: "evt-1",
        type: "run.updated",
        occurredAt: "2026-03-09T10:05:00.000Z",
        summary: "Execution running",
      },
      {
        id: "evt-2",
        type: "step.updated",
        occurredAt: "2026-03-09T10:04:30.000Z",
        summary: "shell running",
      },
    ],
  });

  const ws2 = makeWorkstream({
    id: "agent:researcher:main::main",
    key: "agent:researcher:main",
    lane: "main",
    agentId: "researcher",
    persona: {
      name: "Iris",
      description: "Research analyst",
      tone: "curious",
      palette: "ocean",
      character: "researcher",
    },
    latestRunId: "run-2",
    runStatus: "paused",
    queuedRunCount: 0,
    attentionLevel: "critical",
    attentionScore: 900,
    currentRoom: "approval-desk",
    bubbleText: "Awaiting approval to read credentials",
    recentEvents: [
      {
        id: "evt-3",
        type: "approval.updated",
        occurredAt: "2026-03-09T10:03:00.000Z",
        summary: "Approval pending",
      },
    ],
  });

  const ws3 = makeWorkstream({
    id: "agent:builder:main::main",
    key: "agent:builder:main",
    lane: "main",
    agentId: "builder",
    persona: {
      name: "Forge",
      description: "Infrastructure builder",
      tone: "steady",
      palette: "ember",
      character: "builder",
    },
    attentionLevel: "idle",
    attentionScore: 100,
    currentRoom: "lounge",
  });

  const ws4 = makeWorkstream({
    id: "agent:analyst:main::main",
    key: "agent:analyst:main",
    lane: "main",
    agentId: "analyst",
    persona: {
      name: "Lens",
      description: "Data analyst",
      tone: "measured",
      palette: "slate",
      character: "analyst",
    },
    latestRunId: "run-3",
    runStatus: "succeeded",
    queuedRunCount: 0,
    attentionLevel: "low",
    attentionScore: 400,
    currentRoom: "library",
    recentEvents: [
      {
        id: "evt-4",
        type: "memory.item.updated",
        occurredAt: "2026-03-09T10:01:00.000Z",
        summary: "Indexed new procedure",
      },
    ],
  });

  const workstreamsById: Record<string, ActivityWorkstream> = {
    [ws1.id]: ws1,
    [ws2.id]: ws2,
    [ws3.id]: ws3,
    [ws4.id]: ws4,
  };
  const workstreamIds = [ws2.id, ws1.id, ws4.id, ws3.id];

  const agentsById: Record<string, ActivityAgent> = {
    default: {
      agentId: "default",
      persona: ws1.persona,
      workstreamIds: [ws1.id],
      selectedWorkstreamId: null,
    },
    researcher: {
      agentId: "researcher",
      persona: ws2.persona,
      workstreamIds: [ws2.id],
      selectedWorkstreamId: null,
    },
    builder: {
      agentId: "builder",
      persona: ws3.persona,
      workstreamIds: [ws3.id],
      selectedWorkstreamId: null,
    },
    analyst: {
      agentId: "analyst",
      persona: ws4.persona,
      workstreamIds: [ws4.id],
      selectedWorkstreamId: null,
    },
  };
  const agentIds = ["default", "researcher", "builder", "analyst"];

  const initialState: ActivityState = {
    agentsById,
    agentIds,
    workstreamsById,
    workstreamIds,
    selectedAgentId: null,
    selectedWorkstreamId: ws1.id,
  };

  const { store, setState } = createStore(initialState);

  return {
    ...store,
    clearSelection() {
      setState((prev) => ({ ...prev, selectedWorkstreamId: null, selectedAgentId: null }));
    },
    selectWorkstream(workstreamId: string | null) {
      const ws = workstreamId ? workstreamsById[workstreamId] : null;
      setState((prev) => ({
        ...prev,
        selectedWorkstreamId: workstreamId,
        selectedAgentId: ws?.agentId ?? null,
      }));
    },
  };
}
