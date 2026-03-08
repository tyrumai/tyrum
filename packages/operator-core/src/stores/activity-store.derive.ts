import type { Approval, ExecutionRun } from "@tyrum/client";
import type { ActivityState, ActivityWorkstream } from "./activity-store.js";
import type { ActivityStoreDeps } from "./activity-store.js";
import type { RunsState } from "./runs-store.js";
import {
  compareEvents,
  compareWorkstreamIds,
  createPersonaMap,
  createSessionAgentMap,
  determineBubbleText,
  determinePriority,
  determineRoom,
  fallbackPersona,
  findLatestAttempt,
  findLatestRun,
  findLatestStep,
  makeDraftWorkstream,
  memorySummary,
  normalizeLane,
  parseStatusLanes,
  runSummary,
  stepSummary,
  attemptSummary,
  approvalSummary,
  toEvent,
  type DraftWorkstream,
  type MessageActivity,
} from "./activity-store.helpers.js";

function resolveApprovalScope(
  approval: Approval,
  runsState: RunsState,
): { key: string; lane: string } | null {
  const key = approval.scope?.key;
  if (key) return { key, lane: normalizeLane(approval.scope?.lane) };

  const runId = approval.scope?.run_id;
  if (!runId) return null;
  const run = runsState.runsById[runId];
  return run ? { key: run.key, lane: normalizeLane(run.lane) } : null;
}

function addDraft(
  drafts: Map<string, DraftWorkstream>,
  key: string,
  lane: string,
  sessionAgents: Map<string, string>,
): DraftWorkstream {
  const id = `${key}::${lane}`;
  const existing = drafts.get(id);
  if (existing) return existing;

  const draft = makeDraftWorkstream(id, key, lane, sessionAgents);
  drafts.set(id, draft);
  return draft;
}

function buildWorkstreams(
  deps: ActivityStoreDeps,
  messageActivityById: Map<string, MessageActivity>,
): Record<string, ActivityWorkstream> {
  const runsState = deps.runsStore.getSnapshot();
  const approvalsState = deps.approvalsStore.getSnapshot();
  const statusState = deps.statusStore.getSnapshot();
  const memoryState = deps.memoryStore.getSnapshot();
  const chatState = deps.chatStore.getSnapshot();

  const sessionAgents = createSessionAgentMap(chatState);
  const personas = createPersonaMap(chatState);
  const drafts = new Map<string, DraftWorkstream>();
  const runsByWorkstreamId = new Map<string, ExecutionRun[]>();

  for (const run of Object.values(runsState.runsById)) {
    const draft = addDraft(drafts, run.key, normalizeLane(run.lane), sessionAgents);
    draft.latestRun = draft.latestRun
      ? ([draft.latestRun, run].toSorted((left, right) =>
          right.created_at.localeCompare(left.created_at),
        )[0] ?? run)
      : run;
    const existingRuns = runsByWorkstreamId.get(draft.id) ?? [];
    existingRuns.push(run);
    runsByWorkstreamId.set(draft.id, existingRuns);
  }

  for (const lane of parseStatusLanes(statusState.status)) {
    addDraft(drafts, lane.key, lane.lane, sessionAgents).statusLane = lane;
  }

  for (const approval of Object.values(approvalsState.byId)) {
    const scope = resolveApprovalScope(approval, runsState);
    if (!scope) continue;
    addDraft(drafts, scope.key, scope.lane, sessionAgents).approvals.push(approval);
  }

  const memoryResults = memoryState.browse.results;
  if (memoryResults?.kind === "list") {
    for (const item of memoryResults.items) {
      const sessionId = item.provenance.session_id?.trim();
      if (!sessionId) continue;
      addDraft(drafts, sessionId, "main", sessionAgents).memoryEvents.push(
        toEvent(
          `memory:${item.memory_item_id}`,
          "memory.item.updated",
          item.updated_at ?? item.created_at,
          memorySummary(item),
        ),
      );
    }
  }

  for (const message of messageActivityById.values()) {
    addDraft(drafts, message.key, message.lane, sessionAgents).message = message;
  }

  const workstreamsById: Record<string, ActivityWorkstream> = {};
  for (const draft of drafts.values()) {
    const runs = runsByWorkstreamId.get(draft.id) ?? [];
    const latestRun = draft.latestRun ?? findLatestRun(runs);
    const latestRunId = latestRun?.run_id ?? draft.statusLane?.latestRunId ?? null;
    const runStatus = latestRun?.status ?? draft.statusLane?.latestRunStatus ?? null;
    const queuedRunCount = Math.max(
      runs.filter((run) => run.status === "queued").length,
      draft.statusLane?.queuedRuns ?? 0,
    );
    const lease = draft.statusLane?.lease ?? { owner: null, expiresAtMs: null, active: false };
    const agentId = draft.agentId ?? "default";
    const persona = personas.get(agentId) ?? fallbackPersona(agentId);
    const latestStep = latestRun ? findLatestStep(latestRun.run_id, runsState) : null;
    const latestAttempt = latestRun ? findLatestAttempt(latestRun.run_id, runsState) : null;
    const recentEvents = [
      ...(latestRun
        ? [
            toEvent(
              `run:${latestRun.run_id}`,
              "run.updated",
              latestRun.finished_at ?? latestRun.started_at ?? latestRun.created_at,
              runSummary(latestRun),
            ),
          ]
        : []),
      ...(latestStep
        ? [
            toEvent(
              `step:${latestStep.step_id}`,
              "step.updated",
              latestStep.created_at,
              stepSummary(latestStep),
            ),
          ]
        : []),
      ...(latestAttempt
        ? [
            toEvent(
              `attempt:${latestAttempt.attempt_id}`,
              "attempt.updated",
              latestAttempt.finished_at ?? latestAttempt.started_at,
              attemptSummary(latestAttempt),
            ),
          ]
        : []),
      ...draft.approvals.map((approval) =>
        toEvent(
          `approval:${approval.approval_id}`,
          "approval.updated",
          approval.resolution?.resolved_at ?? approval.created_at,
          approvalSummary(approval),
        ),
      ),
      ...draft.memoryEvents,
      ...(draft.message?.recentEvents ?? []),
    ]
      .toSorted(compareEvents)
      .slice(0, 10);

    const priority = determinePriority(
      draft.approvals,
      runStatus,
      queuedRunCount,
      draft.message,
      draft.memoryEvents,
      lease,
    );

    workstreamsById[draft.id] = {
      id: draft.id,
      key: draft.key,
      lane: draft.lane,
      agentId,
      persona,
      latestRunId,
      runStatus,
      queuedRunCount,
      lease,
      attentionLevel: priority.level,
      currentRoom: determineRoom(priority, draft.message, draft.memoryEvents, runStatus),
      bubbleText: determineBubbleText(
        draft.approvals,
        latestAttempt,
        latestRun,
        draft.message,
        draft.memoryEvents,
      ),
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
