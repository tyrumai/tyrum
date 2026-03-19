import type { Approval, ExecutionAttempt, ExecutionRun, ExecutionStep } from "@tyrum/client";
import { parseTyrumKey, type AgentPersona, type ExecutionRunStatus } from "@tyrum/contracts";
import type {
  ActivityAttentionLevel,
  ActivityEvent,
  ActivityLeaseState,
  ActivityRoom,
  ActivityState,
  ActivityWorkstream,
} from "./activity-store.js";
import type { ChatState } from "./chat-store.js";
import type { RunsState } from "./runs-store.js";
import { isApprovalBlockedStatus } from "../review-status.js";

const MAIN_LANE = "main";
const MAX_RECENT_EVENTS = 10;
const DEFAULT_PERSONA: Omit<AgentPersona, "name"> = {
  tone: "direct",
  palette: "graphite",
  character: "operator",
};

export type MessageActivity = {
  key: string;
  lane: string;
  typing: boolean;
  bubbleText: string | null;
  recentEvents: ActivityEvent[];
};

type ParsedStatusLane = {
  key: string;
  lane: string;
  latestRunId: string | null;
  latestRunStatus: ExecutionRunStatus | null;
  queuedRuns: number;
  lease: ActivityLeaseState;
};

export type DraftWorkstream = {
  id: string;
  key: string;
  lane: string;
  agentId: string | null;
  latestRun: ExecutionRun | null;
  statusLane: ParsedStatusLane | null;
  approvals: Approval[];
  message: MessageActivity | null;
};

type Priority = {
  level: ActivityAttentionLevel;
  score: number;
  reason: "approval" | "failure" | "paused" | "message" | "running" | "queued" | "lease" | "status";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createEmptyActivityState(): ActivityState {
  return {
    agentsById: {},
    agentIds: [],
    workstreamsById: {},
    workstreamIds: [],
    selectedAgentId: null,
    selectedWorkstreamId: null,
  };
}

export function normalizeLane(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : MAIN_LANE;
}

function normalizeOccurredAt(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : new Date().toISOString();
}

export function trimText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function toEvent(
  id: string,
  type: ActivityEvent["type"],
  occurredAt: string | null | undefined,
  summary: string,
): ActivityEvent {
  return { id, type, occurredAt: normalizeOccurredAt(occurredAt), summary };
}

export function appendRecentEvent(events: ActivityEvent[], next: ActivityEvent): ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>();
  for (const event of events) {
    byId.set(event.id, event);
  }
  byId.set(next.id, next);
  return [...byId.values()].toSorted(compareEvents).slice(0, MAX_RECENT_EVENTS);
}

export function compareEvents(left: ActivityEvent, right: ActivityEvent): number {
  const timeCmp = right.occurredAt.localeCompare(left.occurredAt);
  if (timeCmp !== 0) return timeCmp;
  return left.id.localeCompare(right.id);
}

export function compareRuns(left: ExecutionRun, right: ExecutionRun): number {
  const timeCmp = right.created_at.localeCompare(left.created_at);
  if (timeCmp !== 0) return timeCmp;
  if (left.attempt !== right.attempt) return right.attempt - left.attempt;
  return left.run_id.localeCompare(right.run_id);
}

function compareSteps(left: ExecutionStep, right: ExecutionStep): number {
  const timeCmp = right.created_at.localeCompare(left.created_at);
  if (timeCmp !== 0) return timeCmp;
  return right.step_index - left.step_index;
}

function compareAttempts(left: ExecutionAttempt, right: ExecutionAttempt): number {
  const leftTime = left.finished_at ?? left.started_at;
  const rightTime = right.finished_at ?? right.started_at;
  const timeCmp = rightTime.localeCompare(leftTime);
  if (timeCmp !== 0) return timeCmp;
  if (left.attempt !== right.attempt) return right.attempt - left.attempt;
  return left.attempt_id.localeCompare(right.attempt_id);
}

function safeAgentIdFromKey(key: string): string | null {
  try {
    const parsed = parseTyrumKey(key);
    return parsed.kind === "agent" ? parsed.agent_key : null;
  } catch {
    return null;
  }
}

function titleCaseAgentId(agentId: string): string {
  return agentId
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function fallbackPersona(agentId: string): AgentPersona {
  return { name: titleCaseAgentId(agentId) || "Agent", ...DEFAULT_PERSONA };
}

export function createPersonaMap(chat: ChatState): Map<string, AgentPersona> {
  const personas = new Map<string, AgentPersona>();
  for (const agent of chat.agents.agents) {
    if (agent.persona) {
      personas.set(agent.agent_id, agent.persona);
    }
  }
  return personas;
}

export function createSessionAgentMap(chat: ChatState): Map<string, string> {
  const sessions = new Map<string, string>();
  for (const session of chat.sessions.sessions) {
    sessions.set(session.session_id, session.agent_id);
  }
  const activeSession = chat.active.session;
  if (activeSession) {
    sessions.set(activeSession.session_id, activeSession.agent_id);
  }
  return sessions;
}

export function parseStatusLanes(status: { session_lanes?: unknown } | null): ParsedStatusLane[] {
  const raw = status?.session_lanes;
  if (!Array.isArray(raw)) return [];

  const lanes: ParsedStatusLane[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const key = trimText(typeof entry["key"] === "string" ? entry["key"] : null);
    if (!key) continue;
    const latestRunStatusRaw =
      typeof entry["latest_run_status"] === "string" ? entry["latest_run_status"] : null;
    lanes.push({
      key,
      lane: normalizeLane(typeof entry["lane"] === "string" ? entry["lane"] : null),
      latestRunId: trimText(
        typeof entry["latest_run_id"] === "string" ? entry["latest_run_id"] : null,
      ),
      latestRunStatus: isRunStatus(latestRunStatusRaw) ? latestRunStatusRaw : null,
      queuedRuns: parseFiniteNumber(entry["queued_runs"]) ?? 0,
      lease: {
        owner: trimText(typeof entry["lease_owner"] === "string" ? entry["lease_owner"] : null),
        expiresAtMs: parseFiniteNumber(entry["lease_expires_at_ms"]),
        active: entry["lease_active"] === true,
      },
    });
  }
  return lanes;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isRunStatus(value: string | null): value is ExecutionRunStatus {
  return (
    value === "queued" ||
    value === "running" ||
    value === "paused" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled"
  );
}

export function runSummary(run: ExecutionRun): string {
  if (run.status === "paused") {
    return trimText(run.paused_detail) ?? trimText(run.paused_reason) ?? "Execution paused";
  }
  if (run.status === "failed") return "Execution failed";
  if (run.status === "running") return "Execution running";
  if (run.status === "queued") return "Execution queued";
  if (run.status === "succeeded") return "Execution succeeded";
  return "Execution cancelled";
}

export function stepSummary(step: ExecutionStep): string {
  return `${step.action.type} ${step.status}`;
}

export function attemptSummary(attempt: ExecutionAttempt): string {
  return attempt.error ?? `Attempt ${attempt.status}`;
}

export function approvalSummary(approval: Approval): string {
  return isApprovalBlockedStatus(approval.status) ? approval.prompt : `Approval ${approval.status}`;
}

export function determinePriority(
  approvals: Approval[],
  runStatus: ExecutionRunStatus | null,
  queuedRunCount: number,
  message: MessageActivity | null,
  lease: ActivityLeaseState,
): Priority {
  if (approvals.some((approval) => isApprovalBlockedStatus(approval.status))) {
    return { level: "critical", score: 900, reason: "approval" };
  }
  if (runStatus === "failed") return { level: "high", score: 800, reason: "failure" };
  if (runStatus === "paused") return { level: "medium", score: 700, reason: "paused" };
  if (message && message.recentEvents.length > 0) {
    return { level: "medium", score: 650, reason: "message" };
  }
  if (runStatus === "running") return { level: "medium", score: 600, reason: "running" };
  if (queuedRunCount > 0 || runStatus === "queued") {
    return { level: "low", score: 500, reason: "queued" };
  }
  if (lease.active) return { level: "low", score: 300, reason: "lease" };
  return { level: "idle", score: 100, reason: "status" };
}

export function determineRoom(
  priority: Priority,
  message: MessageActivity | null,
  runStatus: ExecutionRunStatus | null,
): ActivityRoom {
  if (priority.reason === "approval") return "approval-desk";
  if (message && message.recentEvents.length > 0) return "mail-room";
  if (runStatus === "failed" || runStatus === "succeeded" || runStatus === "cancelled") {
    return "archive";
  }
  if (runStatus === "running") return "terminal-lab";
  if (runStatus === "paused" || runStatus === "queued") return "strategy-desk";
  return "lounge";
}

export function determineBubbleText(
  approvals: Approval[],
  latestAttempt: ExecutionAttempt | null,
  latestRun: ExecutionRun | null,
  message: MessageActivity | null,
): string | null {
  const pendingApproval = approvals.find((approval) => isApprovalBlockedStatus(approval.status));
  if (pendingApproval) return pendingApproval.prompt;
  if (latestAttempt?.error) return latestAttempt.error;
  if (latestRun?.status === "paused") {
    const pausedBubble = trimText(latestRun.paused_detail) ?? trimText(latestRun.paused_reason);
    if (pausedBubble) return pausedBubble;
  }
  if (message?.bubbleText) return message.bubbleText;
  return null;
}

export function compareWorkstreamIds(
  leftId: string,
  rightId: string,
  workstreamsById: Record<string, ActivityWorkstream>,
): number {
  const left = workstreamsById[leftId];
  const right = workstreamsById[rightId];
  if (!left || !right) return leftId.localeCompare(rightId);

  const levelOrder: Record<ActivityAttentionLevel, number> = {
    critical: 5,
    high: 4,
    medium: 3,
    low: 2,
    idle: 1,
  };
  const levelCmp = levelOrder[right.attentionLevel] - levelOrder[left.attentionLevel];
  if (levelCmp !== 0) return levelCmp;

  const scoreCmp = right.attentionScore - left.attentionScore;
  if (scoreCmp !== 0) return scoreCmp;

  const leftTime = left.recentEvents[0]?.occurredAt ?? "";
  const rightTime = right.recentEvents[0]?.occurredAt ?? "";
  const timeCmp = rightTime.localeCompare(leftTime);
  if (timeCmp !== 0) return timeCmp;
  return left.id.localeCompare(right.id);
}

export function findLatestRun(runs: ExecutionRun[]): ExecutionRun | null {
  return runs.toSorted(compareRuns)[0] ?? null;
}

export function findLatestStep(runId: string, runsState: RunsState): ExecutionStep | null {
  const stepIds = runsState.stepIdsByRunId[runId] ?? [];
  const steps = stepIds
    .map((stepId) => runsState.stepsById[stepId])
    .filter((step): step is ExecutionStep => step !== undefined);
  return steps.toSorted(compareSteps)[0] ?? null;
}

export function findLatestAttempt(runId: string, runsState: RunsState): ExecutionAttempt | null {
  const stepIds = runsState.stepIdsByRunId[runId] ?? [];
  const attempts: ExecutionAttempt[] = [];
  for (const stepId of stepIds) {
    for (const attemptId of runsState.attemptIdsByStepId[stepId] ?? []) {
      const attempt = runsState.attemptsById[attemptId];
      if (attempt) attempts.push(attempt);
    }
  }
  return attempts.toSorted(compareAttempts)[0] ?? null;
}

export function makeDraftWorkstream(
  id: string,
  key: string,
  lane: string,
  sessionAgents: Map<string, string>,
): DraftWorkstream {
  return {
    id,
    key,
    lane,
    agentId: safeAgentIdFromKey(key) ?? sessionAgents.get(key) ?? null,
    latestRun: null,
    statusLane: null,
    approvals: [],
    message: null,
  };
}
