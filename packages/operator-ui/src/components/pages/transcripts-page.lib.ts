import type {
  Approval,
  ArtifactRef,
  TranscriptConversationSummary,
  TranscriptSubagentEvent,
  TranscriptTimelineEvent,
  TranscriptTurnEvent,
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
  turn: true,
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

export function formatConversationTitle(conversation: TranscriptConversationSummary): string {
  const title = conversation.title.trim();
  if (title) {
    return title;
  }
  const threadId = conversation.thread_id.trim();
  if (threadId) {
    return threadId;
  }
  return conversation.conversation_key;
}

export function compareConversationsByUpdatedAtDesc(
  left: TranscriptConversationSummary,
  right: TranscriptConversationSummary,
): number {
  const timeCompare = right.updated_at.localeCompare(left.updated_at);
  if (timeCompare !== 0) {
    return timeCompare;
  }
  return left.conversation_key.localeCompare(right.conversation_key);
}

export function compareConversationsByCreatedAtAsc(
  left: TranscriptConversationSummary,
  right: TranscriptConversationSummary,
): number {
  const timeCompare = left.created_at.localeCompare(right.created_at);
  if (timeCompare !== 0) {
    return timeCompare;
  }
  return left.conversation_key.localeCompare(right.conversation_key);
}

export function buildConversationTreeEntries(
  conversations: TranscriptConversationSummary[],
): Array<{ session: TranscriptConversationSummary; depth: number }> {
  const byParentKey = new Map<string, TranscriptConversationSummary[]>();
  const roots: TranscriptConversationSummary[] = [];
  const sessionsByKey = new Map(
    conversations.map((session) => [session.conversation_key, session]),
  );

  for (const session of conversations) {
    const parentSessionKey = session.parent_conversation_key?.trim();
    if (!parentSessionKey || !sessionsByKey.has(parentSessionKey)) {
      roots.push(session);
      continue;
    }
    const siblings = byParentKey.get(parentSessionKey) ?? [];
    siblings.push(session);
    byParentKey.set(parentSessionKey, siblings);
  }

  const orderedRoots = roots.toSorted(compareConversationsByUpdatedAtDesc);
  const orderedSessions = conversations.toSorted(compareConversationsByUpdatedAtDesc);
  const result: Array<{ session: TranscriptConversationSummary; depth: number }> = [];
  const visited = new Set<string>();
  const visit = (session: TranscriptConversationSummary, depth: number): void => {
    if (visited.has(session.conversation_key)) {
      return;
    }
    visited.add(session.conversation_key);
    result.push({ session, depth });
    const children = (byParentKey.get(session.conversation_key) ?? []).toSorted(
      compareConversationsByCreatedAtAsc,
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
    case "turn":
      return "Turn";
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
  _focusSession: TranscriptConversationSummary | null,
): InspectorField[] {
  const fields: InspectorField[] = [];
  if (!event) {
    return fields;
  }
  fields.push({ label: "Occurred", value: event.occurred_at });

  if (event.kind === "turn") {
    fields.push({ label: "Turn", value: event.payload.turn.turn_id });
    fields.push({ label: "Conversation", value: event.payload.turn.conversation_key });
    return fields;
  }

  if (event.kind === "approval") {
    return fields;
  }

  if (event.kind === "subagent") {
    fields.push({ label: "Profile", value: event.payload.subagent.execution_profile });
  }

  return fields;
}

export function collectSelectedEventArtifacts(
  event: TranscriptTimelineEvent | null,
): ArtifactRef[] {
  if (!event || event.kind !== "turn") {
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

export function turnStatusVariant(status: TranscriptTurnEvent["payload"]["turn"]["status"]) {
  if (status === "succeeded") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (status === "running" || status === "queued" || status === "paused") return "warning";
  return "outline";
}

export function subagentPhaseVariant(phase: TranscriptSubagentEvent["payload"]["phase"]) {
  return phase === "closed" ? "outline" : "warning";
}
