import type {
  Approval,
  ArtifactRef,
  TranscriptRunEvent,
  TranscriptSessionSummary,
  TranscriptSubagentEvent,
  TranscriptTimelineEvent,
} from "@tyrum/contracts";
import type { UIMessage } from "ai";
import { normalizeAgentOptions as normalizeAgentOptionsShared } from "./agent-options.shared.js";

export type AgentOption = {
  agentKey: string;
  label: string;
};

export type TimelineKindFilters = Record<TranscriptTimelineEvent["kind"], boolean>;

export type InspectorField = {
  label: string;
  value: string;
};

export const DEFAULT_KIND_FILTERS: TimelineKindFilters = {
  message: true,
  run: true,
  approval: true,
  subagent: true,
};

export function normalizeAgentOptions(
  input: Array<{
    agent_key?: string;
    persona?: { name?: string };
  }>,
): AgentOption[] {
  return normalizeAgentOptionsShared(
    input,
    ({ agentKey, personaName }) => ({
      agentKey,
      label: personaName && personaName !== agentKey ? `${personaName} (${agentKey})` : agentKey,
    }),
    {
      sort: (left, right) => left.label.localeCompare(right.label),
    },
  );
}

export function formatSessionTitle(session: TranscriptSessionSummary): string {
  const title = session.title.trim();
  if (title) {
    return title;
  }
  const threadId = session.thread_id.trim();
  if (threadId) {
    return threadId;
  }
  return session.session_key;
}

function compareSessionsByUpdatedAtDesc(
  left: TranscriptSessionSummary,
  right: TranscriptSessionSummary,
): number {
  const timeCompare = right.updated_at.localeCompare(left.updated_at);
  if (timeCompare !== 0) {
    return timeCompare;
  }
  return left.session_key.localeCompare(right.session_key);
}

function compareSessionsByCreatedAtAsc(
  left: TranscriptSessionSummary,
  right: TranscriptSessionSummary,
): number {
  const timeCompare = left.created_at.localeCompare(right.created_at);
  if (timeCompare !== 0) {
    return timeCompare;
  }
  return left.session_key.localeCompare(right.session_key);
}

export function buildSessionTreeEntries(
  sessions: TranscriptSessionSummary[],
): Array<{ session: TranscriptSessionSummary; depth: number }> {
  const byParentKey = new Map<string, TranscriptSessionSummary[]>();
  const roots: TranscriptSessionSummary[] = [];
  const sessionsByKey = new Map(sessions.map((session) => [session.session_key, session]));

  for (const session of sessions) {
    const parentSessionKey = session.parent_session_key?.trim();
    if (!parentSessionKey || !sessionsByKey.has(parentSessionKey)) {
      roots.push(session);
      continue;
    }
    const siblings = byParentKey.get(parentSessionKey) ?? [];
    siblings.push(session);
    byParentKey.set(parentSessionKey, siblings);
  }

  const orderedRoots = roots.toSorted(compareSessionsByUpdatedAtDesc);
  const orderedSessions = sessions.toSorted(compareSessionsByUpdatedAtDesc);
  const result: Array<{ session: TranscriptSessionSummary; depth: number }> = [];
  const visited = new Set<string>();
  const visit = (session: TranscriptSessionSummary, depth: number): void => {
    if (visited.has(session.session_key)) {
      return;
    }
    visited.add(session.session_key);
    result.push({ session, depth });
    const children = (byParentKey.get(session.session_key) ?? []).toSorted(
      compareSessionsByCreatedAtAsc,
    );
    for (const child of children) {
      visit(child, depth + 1);
    }
  };

  for (const root of orderedRoots) {
    visit(root, 0);
  }
  for (const session of orderedSessions) {
    visit(session, 0);
  }

  return result;
}

export function eventKindLabel(kind: TranscriptTimelineEvent["kind"]): string {
  switch (kind) {
    case "message":
      return "Message";
    case "run":
      return "Execution";
    case "approval":
      return "Approval";
    case "subagent":
      return "Subagent";
  }
  return kind;
}

export function toRenderableMessage(event: TranscriptTimelineEvent): UIMessage | null {
  if (event.kind !== "message") {
    return null;
  }
  return {
    ...event.payload.message,
    role: event.payload.message.role === "tool" ? "assistant" : event.payload.message.role,
  } as UIMessage;
}

export function buildInspectorFields(
  event: TranscriptTimelineEvent | null,
  focusSession: TranscriptSessionSummary | null,
): InspectorField[] {
  const fields: InspectorField[] = [];
  if (focusSession) {
    fields.push({ label: "Session key", value: focusSession.session_key });
    fields.push({ label: "Session id", value: focusSession.session_id });
  }
  if (!event) {
    return fields;
  }
  fields.push({ label: "Event id", value: event.event_id });
  fields.push({ label: "Occurred", value: event.occurred_at });
  if (event.parent_session_key) {
    fields.push({ label: "Parent session", value: event.parent_session_key });
  }
  if (event.subagent_id) {
    fields.push({ label: "Subagent id", value: event.subagent_id });
  }

  if (event.kind === "run") {
    fields.push({ label: "Run id", value: event.payload.run.run_id });
    fields.push({ label: "Job id", value: event.payload.run.job_id });
    fields.push({ label: "Run key", value: event.payload.run.key });
    for (const step of event.payload.steps) {
      fields.push({ label: `Step ${step.step_index}`, value: step.step_id });
    }
    for (const attempt of event.payload.attempts) {
      fields.push({ label: `Attempt ${attempt.attempt}`, value: attempt.attempt_id });
    }
    return fields;
  }

  if (event.kind === "approval") {
    fields.push({ label: "Approval id", value: event.payload.approval.approval_id });
    if (event.payload.approval.scope?.run_id) {
      fields.push({ label: "Run id", value: event.payload.approval.scope.run_id });
    }
    if (event.payload.approval.scope?.step_id) {
      fields.push({ label: "Step id", value: event.payload.approval.scope.step_id });
    }
    if (event.payload.approval.scope?.attempt_id) {
      fields.push({ label: "Attempt id", value: event.payload.approval.scope.attempt_id });
    }
    return fields;
  }

  if (event.kind === "subagent") {
    fields.push({ label: "Subagent id", value: event.payload.subagent.subagent_id });
    fields.push({ label: "Subagent session", value: event.payload.subagent.session_key });
    if (event.payload.subagent.parent_session_key) {
      fields.push({ label: "Parent session", value: event.payload.subagent.parent_session_key });
    }
  }

  return fields;
}

export function collectSelectedEventArtifacts(
  event: TranscriptTimelineEvent | null,
): ArtifactRef[] {
  if (!event || event.kind !== "run") {
    return [];
  }
  const artifactsById = new Map<string, ArtifactRef>();
  for (const attempt of event.payload.attempts) {
    for (const artifact of attempt.artifacts) {
      artifactsById.set(artifact.artifact_id, artifact);
    }
  }
  return [...artifactsById.values()];
}

export function approvalStatusVariant(status: Approval["status"]) {
  if (status === "approved") return "success";
  if (status === "denied" || status === "cancelled" || status === "expired") return "danger";
  if (status === "queued" || status === "reviewing" || status === "awaiting_human") {
    return "warning";
  }
  return "outline";
}

export function runStatusVariant(status: TranscriptRunEvent["payload"]["run"]["status"]) {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "running" || status === "queued" || status === "paused") return "warning";
  return "outline";
}

export function subagentPhaseVariant(phase: TranscriptSubagentEvent["payload"]["phase"]) {
  return phase === "closed" ? "outline" : "warning";
}
