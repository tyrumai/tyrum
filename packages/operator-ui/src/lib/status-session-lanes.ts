import { isRecord } from "../utils/is-record.js";

export function parseAgentIdFromKey(key: string): string | null {
  if (!key.startsWith("agent:")) return null;
  const rest = key.slice("agent:".length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  return rest.slice(0, sep);
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function getActiveAgentIdsFromSessionLanes(sessionLanes: unknown): Set<string> {
  const activeAgentIds = new Set<string>();
  if (!Array.isArray(sessionLanes)) return activeAgentIds;

  for (const lane of sessionLanes) {
    if (!isRecord(lane)) continue;
    const key = lane["key"];
    if (typeof key !== "string") continue;
    const agentId = parseAgentIdFromKey(key);
    if (!agentId) continue;

    const latestStatus = lane["latest_run_status"];
    const queuedRuns = parseFiniteNumber(lane["queued_runs"]) ?? 0;
    const leaseActive = lane["lease_active"] === true;

    const statusActive =
      latestStatus === "queued" || latestStatus === "running" || latestStatus === "paused";

    if (statusActive || queuedRuns > 0 || leaseActive) {
      activeAgentIds.add(agentId);
    }
  }

  return activeAgentIds;
}

export function getActiveExecutionRunsCountFromQueueDepth(queueDepth: unknown): number | null {
  if (!isRecord(queueDepth)) return null;
  const executionRuns = queueDepth["execution_runs"];
  if (!isRecord(executionRuns)) return null;

  const queued = parseFiniteNumber(executionRuns["queued"]);
  const running = parseFiniteNumber(executionRuns["running"]);
  const paused = parseFiniteNumber(executionRuns["paused"]);

  if (queued === null && running === null && paused === null) return null;
  return (queued ?? 0) + (running ?? 0) + (paused ?? 0);
}
