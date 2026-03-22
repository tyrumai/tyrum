import type { TranscriptSessionSummary } from "@tyrum/contracts";
import { formatSessionTitle } from "./transcripts-page.lib.js";

export type ManagedAgentOption = {
  agentKey: string;
  agentId: string;
  canDelete: boolean;
  displayName: string;
  isPrimary: boolean;
};

function trimAgentKey(value: string): string {
  return value.trim();
}

function compareSessionsByUpdatedAtDesc(
  left: TranscriptSessionSummary,
  right: TranscriptSessionSummary,
): number {
  const updatedCompare = right.updated_at.localeCompare(left.updated_at);
  if (updatedCompare !== 0) {
    return updatedCompare;
  }
  return left.session_key.localeCompare(right.session_key);
}

function compareSessionsByCreatedAtAsc(
  left: TranscriptSessionSummary,
  right: TranscriptSessionSummary,
): number {
  const createdCompare = left.created_at.localeCompare(right.created_at);
  if (createdCompare !== 0) {
    return createdCompare;
  }
  return left.session_key.localeCompare(right.session_key);
}

function shortId(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "unknown";
  }
  return trimmed.slice(0, 8);
}

export function selectInitialAgentKey(input: {
  currentAgentKey: string;
  availableAgents: ManagedAgentOption[];
}): string {
  const current = trimAgentKey(input.currentAgentKey);
  if (input.availableAgents.some((agent) => agent.agentKey === current)) {
    return current;
  }
  return (
    input.availableAgents.find((agent) => agent.isPrimary)?.agentKey ??
    input.availableAgents[0]?.agentKey ??
    current
  );
}

export function buildSessionsByKey(
  sessions: readonly TranscriptSessionSummary[],
): Map<string, TranscriptSessionSummary> {
  const byKey = new Map<string, TranscriptSessionSummary>();
  for (const session of sessions) {
    byKey.set(session.session_key, session);
  }
  return byKey;
}

export function buildRootSessionsByAgent(
  sessions: readonly TranscriptSessionSummary[],
): Map<string, TranscriptSessionSummary[]> {
  const rootsByAgent = new Map<string, TranscriptSessionSummary[]>();
  for (const session of sessions) {
    if (session.parent_session_key?.trim()) {
      continue;
    }
    const roots = rootsByAgent.get(session.agent_id) ?? [];
    roots.push(session);
    rootsByAgent.set(session.agent_id, roots);
  }
  for (const [agentKey, roots] of rootsByAgent) {
    rootsByAgent.set(agentKey, roots.toSorted(compareSessionsByUpdatedAtDesc));
  }
  return rootsByAgent;
}

export function reconcileActiveRootByAgentKey(input: {
  currentByAgentKey: Readonly<Record<string, string>>;
  agentKeys: readonly string[];
  rootsByAgent: ReadonlyMap<string, readonly TranscriptSessionSummary[]>;
}): Record<string, string> {
  const nextByAgentKey: Record<string, string> = {};
  for (const agentKey of input.agentKeys) {
    const roots = input.rootsByAgent.get(agentKey) ?? [];
    const currentRootKey = input.currentByAgentKey[agentKey];
    if (currentRootKey && roots.some((root) => root.session_key === currentRootKey)) {
      nextByAgentKey[agentKey] = currentRootKey;
      continue;
    }
    const latestRootKey = roots[0]?.session_key;
    if (latestRootKey) {
      nextByAgentKey[agentKey] = latestRootKey;
    }
  }
  return nextByAgentKey;
}

export function resolveActiveRootSessionKey(input: {
  agentKey: string;
  activeRootByAgentKey: Readonly<Record<string, string>>;
  rootsByAgent: ReadonlyMap<string, readonly TranscriptSessionSummary[]>;
}): string | null {
  const roots = input.rootsByAgent.get(input.agentKey) ?? [];
  const preferredRootKey = input.activeRootByAgentKey[input.agentKey];
  if (preferredRootKey && roots.some((root) => root.session_key === preferredRootKey)) {
    return preferredRootKey;
  }
  return roots[0]?.session_key ?? null;
}

export function buildChildSessionEntries(input: {
  rootSessionKey: string;
  sessionsByKey: ReadonlyMap<string, TranscriptSessionSummary>;
}): Array<{ session: TranscriptSessionSummary; depth: number }> {
  const childrenByParentKey = new Map<string, TranscriptSessionSummary[]>();
  for (const session of input.sessionsByKey.values()) {
    const parentSessionKey = session.parent_session_key?.trim();
    if (!parentSessionKey) {
      continue;
    }
    const siblings = childrenByParentKey.get(parentSessionKey) ?? [];
    siblings.push(session);
    childrenByParentKey.set(parentSessionKey, siblings);
  }

  const result: Array<{ session: TranscriptSessionSummary; depth: number }> = [];
  const visit = (parentSessionKey: string, depth: number): void => {
    const children = (childrenByParentKey.get(parentSessionKey) ?? []).toSorted(
      compareSessionsByCreatedAtAsc,
    );
    for (const child of children) {
      result.push({ session: child, depth });
      visit(child.session_key, depth + 1);
    }
  };

  visit(input.rootSessionKey, 1);
  return result;
}

export function isSessionWithinRootLineage(input: {
  sessionKey: string;
  rootSessionKey: string;
  sessionsByKey: ReadonlyMap<string, TranscriptSessionSummary>;
}): boolean {
  let current = input.sessionsByKey.get(input.sessionKey);
  const visited = new Set<string>();
  while (current) {
    if (current.session_key === input.rootSessionKey) {
      return true;
    }
    if (visited.has(current.session_key)) {
      return false;
    }
    visited.add(current.session_key);
    const parentSessionKey = current.parent_session_key?.trim();
    if (!parentSessionKey) {
      return false;
    }
    current = input.sessionsByKey.get(parentSessionKey);
  }
  return false;
}

export function formatSubagentLabel(session: TranscriptSessionSummary): string {
  const title = session.title.trim();
  if (title) {
    return title;
  }
  const executionProfile = session.execution_profile?.trim();
  if (executionProfile) {
    return `${executionProfile} ${shortId(session.subagent_id)}`;
  }
  return `Subagent ${shortId(session.subagent_id)}`;
}

export function formatConversationLabel(session: TranscriptSessionSummary): string {
  const title = formatSessionTitle(session);
  return `${title} (${session.updated_at.slice(0, 10)})`;
}

export function formatConversationCount(count: number): string {
  if (count === 0) {
    return "No retained transcripts";
  }
  return count === 1 ? "1 conversation" : `${String(count)} conversations`;
}

export function subagentStatusVariant(status: TranscriptSessionSummary["subagent_status"]) {
  if (status === "failed") {
    return "danger";
  }
  if (status === "running" || status === "closing") {
    return "warning";
  }
  if (status === "paused") {
    return "default";
  }
  return "outline";
}
