import { SubagentSessionKey, TyrumKey, parseTyrumKey } from "@tyrum/contracts";
import type { ExecutionRun, ExecutionRunStatus, TranscriptSessionSummary } from "@tyrum/contracts";
import type { StatusResponse } from "@tyrum/operator-app/browser";
import type { DashboardRecentRunRow } from "./dashboard-page.activity-table.js";
import type { WorkSegment } from "./dashboard-page.parts.js";
import { resolveAgentIdForRun } from "../../lib/status-session-lanes.js";

function decodeTurnKeyPart(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed.startsWith("~")) {
    return trimmed;
  }
  try {
    const encoded = trimmed.slice(1).replace(/-/g, "+").replace(/_/g, "/");
    const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
    if (typeof globalThis.atob !== "function") {
      return trimmed;
    }
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return trimmed;
  }
}

function formatKeySegmentLabel(value: string): string {
  return value
    .split(/[-_:/]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatChannelLabel(channel: string): string {
  const decoded = decodeTurnKeyPart(channel);
  if (!decoded) {
    return "Unknown";
  }
  switch (decoded) {
    case "ui":
      return "UI";
    case "googlechat":
      return "Google Chat";
    default:
      return decoded.startsWith("automation:") ? "Automation" : formatKeySegmentLabel(decoded);
  }
}

function formatSourceDetail(parts: Array<string | null | undefined>): string | null {
  const filtered = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0));
  return filtered.length > 0 ? filtered.join(" • ") : null;
}

function formatOptionalAccount(account: string | undefined): string | null {
  const decoded = decodeTurnKeyPart(account);
  if (!decoded || decoded === "default") {
    return null;
  }
  return decoded;
}

function parseDashboardRunKey(key: string) {
  const parsed = TyrumKey.safeParse(key);
  if (!parsed.success) {
    return null;
  }
  try {
    return parseTyrumKey(parsed.data);
  } catch {
    return null;
  }
}

function describeRecentRunSource(input: {
  run: Pick<ExecutionRun, "key" | "lane">;
  matchedSession: TranscriptSessionSummary | undefined;
}): {
  label: string;
  detail: string | null;
  sessionKey: string | null;
  needsTranscriptLookup: boolean;
} {
  if (input.run.lane === "heartbeat") {
    return {
      label: "Heartbeat",
      detail: "Agent main",
      sessionKey: null,
      needsTranscriptLookup: false,
    };
  }

  if (input.run.lane === "cron") {
    const parsed = parseDashboardRunKey(input.run.key);
    return {
      label: "Cron automation",
      detail: parsed?.kind === "cron" ? parsed.job_id : input.run.key,
      sessionKey: null,
      needsTranscriptLookup: false,
    };
  }

  if (SubagentSessionKey.safeParse(input.run.key).success) {
    return {
      label: "Subagent",
      detail: formatSourceDetail([
        input.matchedSession?.execution_profile,
        input.matchedSession?.subagent_id?.slice(0, 8) ??
          input.run.key.split(":").at(-1)?.slice(0, 8),
      ]),
      sessionKey: input.matchedSession?.session_key ?? input.run.key,
      needsTranscriptLookup: input.matchedSession === undefined,
    };
  }

  const parsed = parseDashboardRunKey(input.run.key);
  if (parsed?.kind === "agent") {
    if (parsed.thread_kind === "main") {
      if (!input.matchedSession) {
        return {
          label: "Agent main",
          detail: null,
          sessionKey: input.run.key,
          needsTranscriptLookup: input.run.lane === "main",
        };
      }
      const channelLabel = formatChannelLabel(input.matchedSession.channel);
      return {
        label: channelLabel === "UI" ? "UI thread" : `${channelLabel} DM`,
        detail: decodeTurnKeyPart(input.matchedSession.thread_id),
        sessionKey: input.matchedSession.session_key,
        needsTranscriptLookup: false,
      };
    }

    if (parsed.thread_kind === "dm") {
      const channelLabel = "channel" in parsed ? formatChannelLabel(parsed.channel) : "Direct";
      return {
        label: channelLabel === "Direct" ? "Direct message" : `${channelLabel} DM`,
        detail: formatSourceDetail([
          decodeTurnKeyPart(input.matchedSession?.thread_id ?? parsed.peer_id),
          "account" in parsed ? formatOptionalAccount(parsed.account) : null,
        ]),
        sessionKey: input.matchedSession?.session_key ?? input.run.key,
        needsTranscriptLookup: false,
      };
    }

    if (parsed.thread_kind === "group" || parsed.thread_kind === "channel") {
      const channelLabel = formatChannelLabel(parsed.channel);
      return {
        label:
          channelLabel === "UI" && parsed.thread_kind === "channel"
            ? "UI thread"
            : `${channelLabel} ${parsed.thread_kind}`,
        detail: formatSourceDetail([
          decodeTurnKeyPart(input.matchedSession?.thread_id ?? parsed.id),
          formatOptionalAccount(parsed.account),
        ]),
        sessionKey: input.matchedSession?.session_key ?? input.run.key,
        needsTranscriptLookup: false,
      };
    }
  }

  if (parsed?.kind === "hook") {
    return {
      label: "Hook",
      detail: parsed.uuid.slice(0, 8),
      sessionKey: null,
      needsTranscriptLookup: false,
    };
  }

  if (parsed?.kind === "node") {
    return {
      label: "Node",
      detail: parsed.node_id,
      sessionKey: null,
      needsTranscriptLookup: false,
    };
  }

  return {
    label: formatKeySegmentLabel(input.run.lane),
    detail: input.run.key,
    sessionKey: null,
    needsTranscriptLookup: false,
  };
}

export function getPolicyModeLabel(status: StatusResponse | null): string {
  if (status?.sandbox) return status.sandbox.mode;
  if (!status?.policy) return "-";
  return status.policy.observe_only ? "observe" : "enforce";
}

export function getSandboxHardeningLabel(status: StatusResponse | null): string {
  return status?.sandbox?.hardening_profile ?? "-";
}

export function getElevatedExecutionLabel(status: StatusResponse | null): string {
  const value = status?.sandbox?.elevated_execution_available;
  if (value === null || value === undefined) return "unknown";
  return value ? "available" : "unavailable";
}

export function getAuthEnabledLabel(status: StatusResponse | null): string {
  const enabled = status?.auth?.enabled;
  if (enabled === undefined) return "-";
  return enabled ? "enabled" : "disabled";
}

export function normalizeManagedAgentKeys(
  agents: Array<{
    agent_id?: string;
  }>,
): string[] {
  const unique = new Set<string>();
  for (const agent of agents) {
    const agentKey = agent.agent_id?.trim() ?? "";
    if (!agentKey) continue;
    unique.add(agentKey);
  }
  return [...unique].toSorted((left, right) => left.localeCompare(right));
}

export function buildAgentNameByKey(
  agents: Array<{
    agent_id?: string;
    persona?: {
      name?: string | null;
    } | null;
  }>,
): Map<string, string> {
  const names = new Map<string, string>();
  for (const agent of agents) {
    const agentKey = agent.agent_id?.trim() ?? "";
    if (!agentKey) {
      continue;
    }
    const displayName = agent.persona?.name?.trim();
    names.set(agentKey, displayName && displayName.length > 0 ? displayName : agentKey);
  }
  return names;
}

export function getRunOccurredAt(run: {
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}): string {
  return run.finished_at ?? run.started_at ?? run.created_at;
}

export function buildTranscriptSessionsByKey(
  sessions: TranscriptSessionSummary[],
): Map<string, TranscriptSessionSummary> {
  const byKey = new Map<string, TranscriptSessionSummary>();
  for (const session of sessions) {
    byKey.set(session.session_key, session);
  }
  return byKey;
}

export function buildDashboardWorkDistribution(
  items: Array<{
    status: string;
  }>,
): {
  openWorkCount: number;
  activeWorkCount: number;
  workSegments: WorkSegment[];
  workTotal: number;
} {
  let openWorkCount = 0;
  let activeWorkCount = 0;
  const workStatusCounts = {
    backlog: 0,
    ready: 0,
    doing: 0,
    blocked: 0,
    done: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const item of items) {
    if (item.status in workStatusCounts) {
      workStatusCounts[item.status as keyof typeof workStatusCounts] += 1;
    }
    if (item.status !== "done" && item.status !== "failed" && item.status !== "cancelled") {
      openWorkCount += 1;
    }
    if (item.status === "doing" || item.status === "blocked") {
      activeWorkCount += 1;
    }
  }
  const workSegments: WorkSegment[] = [
    { key: "backlog", count: workStatusCounts.backlog, color: "bg-neutral", label: "Backlog" },
    { key: "ready", count: workStatusCounts.ready, color: "bg-neutral", label: "Ready" },
    { key: "doing", count: workStatusCounts.doing, color: "bg-primary", label: "Doing" },
    { key: "blocked", count: workStatusCounts.blocked, color: "bg-warning", label: "Blocked" },
    { key: "done", count: workStatusCounts.done, color: "bg-success", label: "Done" },
    { key: "failed", count: workStatusCounts.failed, color: "bg-error", label: "Failed" },
    {
      key: "cancelled",
      count: workStatusCounts.cancelled,
      color: "bg-fg-muted/40",
      label: "Cancelled",
    },
  ];
  return {
    openWorkCount,
    activeWorkCount,
    workSegments,
    workTotal: workSegments.reduce((sum, segment) => sum + segment.count, 0),
  };
}

export function buildDashboardRecentRunsState(input: {
  runsById: Record<string, ExecutionRun>;
  agentKeyByRunId?: Record<string, string>;
  agentNameByKey: ReadonlyMap<string, string>;
  transcriptSessionsByKey: ReadonlyMap<string, TranscriptSessionSummary>;
  limit?: number;
}): {
  rows: DashboardRecentRunRow[];
  missingTranscriptKeysKey: string;
} {
  const rows: DashboardRecentRunRow[] = [];
  const missingTranscriptKeys: string[] = [];
  const sortedRuns = Object.values(input.runsById).toSorted((left, right) =>
    getRunOccurredAt(right).localeCompare(getRunOccurredAt(left)),
  );
  for (const run of sortedRuns.slice(0, input.limit ?? 8)) {
    const agentKey = resolveAgentIdForRun(run, input.agentKeyByRunId);
    if (!agentKey) {
      continue;
    }
    const matchedSession =
      run.lane === "heartbeat" || run.lane === "cron"
        ? undefined
        : input.transcriptSessionsByKey.get(run.key);
    const source = describeRecentRunSource({ run, matchedSession });
    if (source.needsTranscriptLookup && !matchedSession) {
      missingTranscriptKeys.push(run.key);
    }
    rows.push({
      id: run.run_id,
      agentKey,
      agentName: input.agentNameByKey.get(agentKey) ?? agentKey,
      sessionKey: source.sessionKey,
      sourceLabel: source.label,
      sourceDetail: source.detail,
      sourceTitle: `${source.label} • ${run.key}`,
      runId: run.run_id,
      runAttempt: run.attempt,
      lane: run.lane,
      occurredAt: getRunOccurredAt(run),
      runStatus: run.status as ExecutionRunStatus,
    });
  }
  return {
    rows,
    missingTranscriptKeysKey: missingTranscriptKeys.toSorted().join("|"),
  };
}
