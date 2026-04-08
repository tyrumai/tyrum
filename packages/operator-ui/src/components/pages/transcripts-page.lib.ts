import type {
  Approval,
  TranscriptContextReportEvent,
  TranscriptConversationSummary,
  TranscriptSubagentEvent,
  TranscriptTimelineEvent,
  TranscriptToolLifecycleEvent,
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

export const TIMELINE_KINDS: TranscriptTimelineEvent["kind"][] = [
  "message",
  "turn",
  "approval",
  "subagent",
  "tool_lifecycle",
  "context_report",
];

export const DEFAULT_KIND_FILTERS: TimelineKindFilters = {
  message: true,
  turn: true,
  approval: true,
  subagent: true,
  tool_lifecycle: true,
  context_report: true,
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
): Array<{ conversation: TranscriptConversationSummary; depth: number }> {
  const byParentKey = new Map<string, TranscriptConversationSummary[]>();
  const roots: TranscriptConversationSummary[] = [];
  const conversationsByKey = new Map(
    conversations.map((conversation) => [conversation.conversation_key, conversation]),
  );

  for (const conversation of conversations) {
    const parentConversationKey = conversation.parent_conversation_key?.trim();
    if (!parentConversationKey || !conversationsByKey.has(parentConversationKey)) {
      roots.push(conversation);
      continue;
    }
    const siblings = byParentKey.get(parentConversationKey) ?? [];
    siblings.push(conversation);
    byParentKey.set(parentConversationKey, siblings);
  }

  const orderedRoots = roots.toSorted(compareConversationsByUpdatedAtDesc);
  const orderedConversations = conversations.toSorted(compareConversationsByUpdatedAtDesc);
  const result: Array<{ conversation: TranscriptConversationSummary; depth: number }> = [];
  const visited = new Set<string>();
  const visit = (conversation: TranscriptConversationSummary, depth: number): void => {
    if (visited.has(conversation.conversation_key)) {
      return;
    }
    visited.add(conversation.conversation_key);
    result.push({ conversation, depth });
    const children = (byParentKey.get(conversation.conversation_key) ?? []).toSorted(
      compareConversationsByCreatedAtAsc,
    );
    for (const child of children) {
      visit(child, depth + 1);
    }
  };

  for (const root of orderedRoots) {
    visit(root, 0);
  }
  for (const conversation of orderedConversations) {
    visit(conversation, 0);
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
    case "tool_lifecycle":
      return "Tool";
    case "context_report":
      return "Context";
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
  _focusConversation: TranscriptConversationSummary | null,
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
    return fields;
  }

  if (event.kind === "tool_lifecycle") {
    fields.push({ label: "Tool", value: event.payload.tool_event.tool_id });
    fields.push({ label: "Call", value: event.payload.tool_event.tool_call_id });
    fields.push({ label: "Status", value: event.payload.tool_event.status });
    return fields;
  }

  if (event.kind === "context_report") {
    fields.push({ label: "Report", value: event.payload.report.context_report_id });
    fields.push({
      label: "Memory",
      value: `${String(event.payload.report.memory.keyword_hits)} keyword / ${String(event.payload.report.memory.semantic_hits)} semantic`,
    });
    return fields;
  }

  return fields;
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

export function toolLifecycleStatusVariant(
  status: TranscriptToolLifecycleEvent["payload"]["tool_event"]["status"],
) {
  if (status === "completed") return "success";
  if (status === "failed" || status === "output-error" || status === "output-denied") {
    return "danger";
  }
  if (
    status === "running" ||
    status === "input-streaming" ||
    status === "input-available" ||
    status === "awaiting_approval" ||
    status === "approval-requested" ||
    status === "output-available"
  ) {
    return "warning";
  }
  return "outline";
}

export function contextReportSummary(event: TranscriptContextReportEvent): string {
  const report = event.payload.report;
  return `${String(report.memory.keyword_hits)} keyword hits • ${String(report.memory.semantic_hits)} semantic hits • ${String(report.tool_calls.length)} tool calls`;
}
