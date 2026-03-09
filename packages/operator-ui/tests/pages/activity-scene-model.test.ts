import { describe, expect, it } from "vitest";
import type { ActivityState } from "../../../operator-core/src/stores/activity-store.js";
import { deriveActivityScene } from "../../src/components/pages/activity-scene-model.js";

function createPersona(name: string) {
  return {
    name,
    description: `${name} operator persona`,
    tone: "direct" as const,
    palette: "graphite" as const,
    character: "operator" as const,
  };
}

function createState(workstreams: ActivityState["workstreamsById"]): ActivityState {
  const alphaIds = Object.keys(workstreams).filter((id) => workstreams[id]?.agentId === "alpha");
  const betaIds = Object.keys(workstreams).filter((id) => workstreams[id]?.agentId === "beta");
  return {
    agentsById: {
      alpha: {
        agentId: "alpha",
        persona: createPersona("Alpha"),
        workstreamIds: alphaIds,
        selectedWorkstreamId: alphaIds[0] ?? null,
      },
      beta: {
        agentId: "beta",
        persona: createPersona("Beta"),
        workstreamIds: betaIds,
        selectedWorkstreamId: betaIds[0] ?? null,
      },
    },
    agentIds: ["alpha", "beta"],
    workstreamsById: workstreams,
    workstreamIds: Object.keys(workstreams),
    selectedAgentId: "alpha",
    selectedWorkstreamId: alphaIds[0] ?? null,
  };
}

function createWorkstream(
  id: string,
  room: NonNullable<ActivityState["workstreamsById"][string]>["currentRoom"],
  lane: string,
  agentId = "alpha",
) {
  return {
    id,
    key: agentId === "alpha" ? "agent:alpha:main" : "agent:beta:ops",
    lane,
    agentId,
    persona: createPersona(agentId === "alpha" ? "Alpha" : "Beta"),
    latestRunId: null,
    runStatus: null,
    queuedRunCount: 0,
    lease: { owner: null, expiresAtMs: null, active: false },
    attentionLevel: "low" as const,
    attentionScore: 20,
    currentRoom: room,
    bubbleText: null,
    recentEvents: [],
  };
}

describe("deriveActivityScene", () => {
  it("assigns actors into their mapped rooms without slot collisions", () => {
    const state = createState({
      "agent:alpha:main::main": createWorkstream("agent:alpha:main::main", "terminal-lab", "main"),
      "agent:alpha:main::review": createWorkstream(
        "agent:alpha:main::review",
        "terminal-lab",
        "review",
      ),
      "agent:beta:ops::main": createWorkstream("agent:beta:ops::main", "mail-room", "main", "beta"),
    });

    const scene = deriveActivityScene(state, state.selectedWorkstreamId);
    const terminalActors = scene.actors.filter((actor) => actor.roomId === "terminal-lab");

    expect(terminalActors).toHaveLength(2);
    expect(new Set(terminalActors.map((actor) => actor.slotId)).size).toBe(2);
    expect(
      scene.actors.find((actor) => actor.workstreamId === "agent:beta:ops::main")?.roomLabel,
    ).toBe("Mail room");
  });

  it("marks same-agent concurrency as a split home bay and keeps shared identity", () => {
    const state = createState({
      "agent:alpha:main::main": createWorkstream("agent:alpha:main::main", "lounge", "main"),
      "agent:alpha:main::review": createWorkstream(
        "agent:alpha:main::review",
        "approval-desk",
        "review",
      ),
    });

    const scene = deriveActivityScene(state, state.selectedWorkstreamId);
    const alphaBay = scene.bays.find((bay) => bay.agentId === "alpha");
    const alphaActors = scene.actors.filter((actor) => actor.agentId === "alpha");

    expect(alphaBay?.state).toBe("split");
    expect(alphaActors).toHaveLength(2);
    expect(new Set(alphaActors.map((actor) => actor.identityId)).size).toBe(1);
    expect(new Set(alphaActors.map((actor) => actor.badgeLabel)).size).toBe(2);
  });

  it("keeps one actor per key plus lane workstream and merges back to a solo bay", () => {
    const state = createState({
      "agent:alpha:main::main": createWorkstream("agent:alpha:main::main", "strategy-desk", "main"),
    });

    const scene = deriveActivityScene(state, state.selectedWorkstreamId);

    expect(scene.actors.map((actor) => actor.workstreamId)).toEqual(["agent:alpha:main::main"]);
    expect(scene.bays.find((bay) => bay.agentId === "alpha")?.state).toBe("merged");
    expect(scene.actors[0]?.badgeLabel).toContain("Main");
    expect(scene.actors[0]?.badgeLabel).toContain("alpha:main");
  });
});
