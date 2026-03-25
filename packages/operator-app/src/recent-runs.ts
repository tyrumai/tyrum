import type { TranscriptConversationSummary, Turn } from "@tyrum/contracts";
import type { RunsState } from "./stores/runs-store.js";

export type OperatorRecentRunSource = {
  label: string;
  detail: string | null;
  title: string;
};

export type OperatorRecentRunRow = {
  id: string;
  runId: string;
  runAttempt: number;
  agentKey: string;
  agentName: string;
  sessionKey: string | null;
  lane: string;
  occurredAt: string;
  runStatus: Turn["status"];
  source: OperatorRecentRunSource;
};

export type RecentRunsState = {
  rows: OperatorRecentRunRow[];
};

function normalizeOptionalString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function titleCaseIdentifier(value: string): string {
  return value
    .split(/[-_:/]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function shortId(value: string | undefined): string | null {
  const trimmed = normalizeOptionalString(value);
  return trimmed ? trimmed.slice(0, 8) : null;
}

function formatConnectorLabel(channel: string): string {
  switch (channel.trim()) {
    case "ui":
      return "UI";
    case "googlechat":
      return "Google Chat";
    default:
      return titleCaseIdentifier(channel);
  }
}

function formatAccountKey(accountKey: string | undefined): string | null {
  const normalized = normalizeOptionalString(accountKey);
  return normalized && normalized !== "default" ? normalized : null;
}

function formatSourceLabel(
  session: TranscriptConversationSummary | undefined,
  conversationKey: string | null,
): string {
  if (!session) {
    if (!conversationKey) {
      return "Conversation";
    }
    if (conversationKey.startsWith("cron:")) return "Cron";
    if (conversationKey.startsWith("hook:")) return "Hook";
    if (conversationKey.startsWith("node:")) return "Node";
    return "Conversation";
  }
  if (normalizeOptionalString(session.subagent_id)) {
    return "Subagent";
  }
  const connector = formatConnectorLabel(session.channel);
  const containerKind = normalizeOptionalString(session.container_kind);
  if (!containerKind) {
    return connector;
  }
  if (connector === "UI") {
    return "UI thread";
  }
  if (containerKind === "dm") {
    return `${connector} DM`;
  }
  return `${connector} ${titleCaseIdentifier(containerKind)}`;
}

function formatSourceDetail(
  session: TranscriptConversationSummary | undefined,
  conversationKey: string | null,
): string | null {
  if (!session) {
    return conversationKey?.startsWith("agent:") ? "Agent conversation" : null;
  }
  if (normalizeOptionalString(session.subagent_id)) {
    return [normalizeOptionalString(session.execution_profile), shortId(session.subagent_id)]
      .filter((part): part is string => part !== null)
      .join(" • ");
  }
  return [normalizeOptionalString(session.thread_id), formatAccountKey(session.account_key)]
    .filter((part): part is string => part !== null)
    .join(" • ");
}

function buildSource(
  session: TranscriptConversationSummary | undefined,
  conversationKey: string | null,
): OperatorRecentRunSource {
  const label = formatSourceLabel(session, conversationKey);
  const detail = formatSourceDetail(session, conversationKey);
  return {
    label,
    detail,
    title: detail ? `${label} • ${detail}` : label,
  };
}

function getRunOccurredAt(run: Turn): string {
  return run.finished_at ?? run.started_at ?? run.created_at;
}

function compareRecentRuns(left: Turn, right: Turn): number {
  const timeCompare = getRunOccurredAt(right).localeCompare(getRunOccurredAt(left));
  if (timeCompare !== 0) {
    return timeCompare;
  }
  return right.turn_id.localeCompare(left.turn_id);
}

export function buildAgentNameByKey(
  agents: Array<{
    agent_key?: string;
    persona?: {
      name?: string | null;
    } | null;
  }>,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const agent of agents) {
    const agentKey = normalizeOptionalString(agent.agent_key);
    if (!agentKey) {
      continue;
    }
    const displayName = normalizeOptionalString(agent.persona?.name ?? null);
    names.set(agentKey, displayName ?? agentKey);
  }
  return names;
}

export function buildTranscriptSessionsByKey(
  sessions: readonly TranscriptConversationSummary[],
): Map<string, TranscriptConversationSummary> {
  const byKey = new Map<string, TranscriptConversationSummary>();
  for (const session of sessions) {
    byKey.set(session.conversation_key, session);
  }
  return byKey;
}

export function buildRecentRunsState(input: {
  runsState: Pick<RunsState, "runsById" | "agentKeyByRunId" | "sessionKeyByRunId">;
  transcriptSessionsByKey: ReadonlyMap<string, TranscriptConversationSummary>;
  agentNameByKey: ReadonlyMap<string, string>;
  limit?: number;
}): RecentRunsState {
  const runs = Object.values(input.runsState.runsById).toSorted(compareRecentRuns);
  const rows: OperatorRecentRunRow[] = [];
  for (const run of runs) {
    if (rows.length >= (input.limit ?? 8)) {
      break;
    }
    const sessionKey = input.runsState.sessionKeyByRunId?.[run.turn_id] ?? null;
    const conversationKey = normalizeOptionalString(sessionKey ?? run.conversation_key);
    const session = sessionKey ? input.transcriptSessionsByKey.get(sessionKey) : undefined;
    const agentKey =
      input.runsState.agentKeyByRunId?.[run.turn_id] ?? session?.agent_key ?? "default";
    rows.push({
      id: run.turn_id,
      runId: run.turn_id,
      runAttempt: run.attempt,
      agentKey,
      agentName: input.agentNameByKey.get(agentKey) ?? agentKey,
      sessionKey,
      lane: session?.container_kind ?? conversationKey ?? "conversation",
      occurredAt: getRunOccurredAt(run),
      runStatus: run.status,
      source: buildSource(session, conversationKey),
    });
  }
  return { rows };
}
