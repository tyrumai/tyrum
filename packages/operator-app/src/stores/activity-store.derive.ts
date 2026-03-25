import type { ActivityState, ActivityWorkstream } from "./activity-store.js";
import type { ActivityStoreDeps } from "./activity-store.js";
import {
  compareWorkstreamIds,
  createConversationAgentMap,
  createPersonaMap,
  determineBubbleText,
  determinePriority,
  determineRoom,
  fallbackPersona,
  inactiveLeaseState,
  makeDraftWorkstream,
  type ActivityIdentity,
  type DraftWorkstream,
  type MessageActivity,
} from "./activity-store.helpers.js";

function addDraft(
  drafts: Map<string, DraftWorkstream>,
  identity: ActivityIdentity,
  conversationAgents: Map<string, string>,
): DraftWorkstream {
  const id = identity.key;
  const existing = drafts.get(id);
  if (existing) {
    return existing;
  }

  const draft = makeDraftWorkstream(identity, conversationAgents);
  drafts.set(id, draft);
  return draft;
}

function buildWorkstreams(
  deps: ActivityStoreDeps,
  messageActivityById: Map<string, MessageActivity>,
): Record<string, ActivityWorkstream> {
  const chatState = deps.chatStore.getSnapshot();
  const conversationAgents = createConversationAgentMap(chatState);
  const personas = createPersonaMap(chatState);
  const drafts = new Map<string, DraftWorkstream>();

  for (const message of messageActivityById.values()) {
    addDraft(
      drafts,
      {
        key: message.key,
        conversationId: message.conversationId,
        threadId: message.threadId,
      },
      conversationAgents,
    ).message = message;
  }

  const workstreamsById: Record<string, ActivityWorkstream> = {};
  for (const draft of drafts.values()) {
    const agentId = draft.agentId ?? "default";
    const persona = personas.get(agentId) ?? fallbackPersona(agentId);
    const priority = determinePriority(draft.message);
    const recentEvents = [...(draft.message?.recentEvents ?? [])];

    workstreamsById[draft.id] = {
      id: draft.id,
      key: draft.key,
      conversationId: draft.conversationId,
      threadId: draft.threadId,
      agentId,
      persona,
      latestRunId: null,
      runStatus: null,
      queuedRunCount: 0,
      lease: inactiveLeaseState(),
      attentionLevel: priority.level,
      attentionScore: priority.score,
      currentRoom: determineRoom(draft.message),
      bubbleText: determineBubbleText(draft.message),
      recentEvents,
    };
  }

  return workstreamsById;
}

export function buildActivityState(
  deps: ActivityStoreDeps,
  selectedWorkstreamId: string | null,
  messageActivityById: Map<string, MessageActivity>,
): ActivityState {
  const workstreamsById = buildWorkstreams(deps, messageActivityById);
  const workstreamIds = Object.keys(workstreamsById).toSorted((left, right) =>
    compareWorkstreamIds(left, right, workstreamsById),
  );
  const nextSelectedWorkstreamId =
    selectedWorkstreamId && workstreamsById[selectedWorkstreamId]
      ? selectedWorkstreamId
      : (workstreamIds[0] ?? null);

  const groupedWorkstreams = new Map<string, string[]>();
  for (const workstreamId of workstreamIds) {
    const workstream = workstreamsById[workstreamId];
    if (!workstream) continue;
    const existing = groupedWorkstreams.get(workstream.agentId) ?? [];
    existing.push(workstreamId);
    groupedWorkstreams.set(workstream.agentId, existing);
  }

  const agentsById: ActivityState["agentsById"] = {};
  const agentIds = [...groupedWorkstreams.keys()].toSorted((left, right) => {
    const leftFirst = groupedWorkstreams.get(left)?.[0];
    const rightFirst = groupedWorkstreams.get(right)?.[0];
    if (!leftFirst || !rightFirst) return left.localeCompare(right);
    return (
      compareWorkstreamIds(leftFirst, rightFirst, workstreamsById) || left.localeCompare(right)
    );
  });

  for (const agentId of agentIds) {
    const agentWorkstreamIds = groupedWorkstreams.get(agentId) ?? [];
    const selectedForAgent = agentWorkstreamIds.includes(nextSelectedWorkstreamId ?? "")
      ? nextSelectedWorkstreamId
      : (agentWorkstreamIds[0] ?? null);
    agentsById[agentId] = {
      agentId,
      persona: workstreamsById[agentWorkstreamIds[0] ?? ""]?.persona ?? fallbackPersona(agentId),
      workstreamIds: agentWorkstreamIds,
      selectedWorkstreamId: selectedForAgent,
    };
  }

  return {
    agentsById,
    agentIds,
    workstreamsById,
    workstreamIds,
    selectedAgentId:
      (nextSelectedWorkstreamId && workstreamsById[nextSelectedWorkstreamId]?.agentId) ??
      agentIds[0] ??
      null,
    selectedWorkstreamId: nextSelectedWorkstreamId,
  };
}
