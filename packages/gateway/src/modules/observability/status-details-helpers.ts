import { isAuthProfilesEnabled } from "../models/auth-profiles-enabled.js";
import type { ModelsDevService } from "../models/models-dev-service.js";
import type { AgentRegistry } from "../agent/registry.js";
import { IdentityScopeDal } from "../identity/scope.js";
import type { SqlDb } from "../../statestore/types.js";
import { isMissingTableError } from "./db-errors.js";

type StatusCountMap = Record<string, number>;
type ActiveModelStatus = {
  model_id: string | null;
  provider: string | null;
  model: string | null;
  fallback_models: string[];
};
type SelectedAuthProfile = {
  agent_id: string;
  conversation_id: string;
  provider: string;
  profile_id: string;
  updated_at: string;
};
export type AuthProfilesStatus = {
  enabled: boolean;
  total: number;
  active: number;
  disabled: number;
  cooldown_active: number;
  oauth_expired: number;
  oauth_expiring_within_24h: number;
  providers: string[];
  disabled_reasons: Array<{ reason: string; count: number }>;
  selected: SelectedAuthProfile | null;
};
export type CatalogFreshnessStatus = {
  source: string | null;
  source_version: string | null;
  provider_count: number;
  model_count: number;
  fetched_at: string | null;
  updated_at: string | null;
  fetched_age_ms: number | null;
  cache_age_ms: number | null;
  last_refresh_status: "ok" | "error" | "unavailable";
  last_error: string | null;
};
export type ConversationLaneStatus = {
  key: string;
  lane: string;
  latest_turn_id: string | null;
  latest_turn_status: string | null;
  queued_turns: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  lease_active: boolean;
};
export type QueueStateStatus = {
  queued: number;
  running?: number;
  paused?: number;
  processing?: number;
  sending?: number;
};
export type QueueDepthStatus = {
  turns: QueueStateStatus;
  turn_jobs: QueueStateStatus;
  channel_inbox: QueueStateStatus;
  channel_outbox: QueueStateStatus;
  watcher_firings: QueueStateStatus;
  pending_total: number;
  inflight_total: number;
};

function parseIsoToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function asFiniteNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parseCatalogCounts(rawJson: string): { providerCount: number; modelCount: number } {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { providerCount: 0, modelCount: 0 };
    }
    const providers = Object.values(parsed as Record<string, unknown>).filter(
      (v): v is Record<string, unknown> => Boolean(v && typeof v === "object"),
    );
    const providerCount = providers.length;
    const modelCount = providers.reduce<number>((total, provider) => {
      const models = (provider as Record<string, unknown>)["models"];
      if (!models || typeof models !== "object") return total;
      return total + Object.keys(models as Record<string, unknown>).length;
    }, 0);
    return { providerCount, modelCount };
  } catch {
    // Intentional: status sampling falls back to 0 counts on invalid cached JSON.
    return { providerCount: 0, modelCount: 0 };
  }
}

async function countByStatus(
  db: SqlDb,
  tenantId: string,
  table: "turns" | "turn_jobs" | "channel_inbox" | "channel_outbox" | "watcher_firings",
  statuses: readonly string[],
): Promise<StatusCountMap> {
  const counts = Object.fromEntries(statuses.map((s) => [s, 0])) as StatusCountMap;
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = await db.all<{ status: string; count: number | string }>(
    `SELECT status, COUNT(*) AS count
     FROM ${table}
     WHERE tenant_id = ?
       AND status IN (${placeholders})
     GROUP BY status`,
    [tenantId, ...statuses],
  );
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(counts, row.status)) {
      counts[row.status] = asFiniteNumber(row.count);
    }
  }
  return counts;
}

export async function loadActiveModel(
  agents: AgentRegistry | undefined,
  db: SqlDb | undefined,
  tenantId: string,
): Promise<ActiveModelStatus | null> {
  if (!agents || !db) return null;

  try {
    const primaryAgentKey = await new IdentityScopeDal(db).resolvePrimaryAgentKey(tenantId);
    if (!primaryAgentKey) {
      return null;
    }
    const runtime = await agents.getRuntime({ tenantId, agentKey: primaryAgentKey });
    const status = await runtime.status(true);
    const modelId = status.model.model;
    if (modelId === null) {
      return {
        model_id: null,
        provider: null,
        model: null,
        fallback_models: status.model.fallback ?? [],
      };
    }
    const slash = modelId.indexOf("/");
    const provider = slash > 0 ? modelId.slice(0, slash) : null;
    const model = slash > 0 && slash < modelId.length - 1 ? modelId.slice(slash + 1) : null;
    return {
      model_id: modelId,
      provider,
      model,
      fallback_models: status.model.fallback ?? [],
    };
  } catch {
    // Intentional: status sampling is best-effort; treat agent runtime status as unavailable.
    return null;
  }
}

export async function loadAuthProfileHealth(
  db: SqlDb | undefined,
  tenantId: string,
): Promise<AuthProfilesStatus | null> {
  if (!db) return null;

  const normalizeTime = (value: string | Date): string =>
    value instanceof Date ? value.toISOString() : value;

  let profiles: Array<{
    provider_key: string;
    type: string;
    status: string;
  }> = [];
  try {
    profiles = await db.all<{ provider_key: string; type: string; status: string }>(
      `SELECT provider_key, type, status
       FROM auth_profiles
       WHERE tenant_id = ?
       ORDER BY updated_at DESC, auth_profile_id DESC
       LIMIT 500`,
      [tenantId],
    );
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }

  let selected: AuthProfilesStatus["selected"] = null;
  try {
    const pin = await db.get<{
      agent_id: string;
      conversation_id: string;
      provider_key: string;
      auth_profile_id: string;
      pinned_at: string | Date;
    }>(
      `SELECT s.agent_id,
              p.conversation_id,
              p.provider_key,
              p.auth_profile_id,
              p.pinned_at
       FROM conversation_provider_pins p
       JOIN conversations s
         ON s.tenant_id = p.tenant_id
        AND s.conversation_id = p.conversation_id
       WHERE p.tenant_id = ?
       ORDER BY p.pinned_at DESC
       LIMIT 1`,
      [tenantId],
    );
    if (pin) {
      selected = {
        agent_id: pin.agent_id,
        conversation_id: pin.conversation_id,
        provider: pin.provider_key,
        profile_id: pin.auth_profile_id,
        updated_at: normalizeTime(pin.pinned_at),
      };
    }
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }

  const total = profiles.length;
  const active = profiles.filter((p) => p.status === "active").length;
  const disabled = profiles.filter((p) => p.status === "disabled").length;
  const providers = [...new Set(profiles.map((p) => p.provider_key))]
    .filter((provider) => provider.trim().length > 0)
    .toSorted();

  return {
    enabled: isAuthProfilesEnabled(),
    total,
    active,
    disabled,
    cooldown_active: 0,
    oauth_expired: 0,
    oauth_expiring_within_24h: 0,
    providers,
    disabled_reasons: [],
    selected,
  };
}

export async function loadCatalogFreshness(
  db: SqlDb | undefined,
  modelsDev: ModelsDevService | undefined,
): Promise<CatalogFreshnessStatus> {
  const nowMs = Date.now();
  const fallback: CatalogFreshnessStatus = {
    source: null,
    source_version: null,
    provider_count: 0,
    model_count: 0,
    fetched_at: null,
    updated_at: null,
    fetched_age_ms: null,
    cache_age_ms: null,
    last_refresh_status: "unavailable",
    last_error: null,
  };

  if (modelsDev) {
    try {
      const loaded = await modelsDev.ensureLoaded();
      const fetchedAtMs = parseIsoToMs(loaded.status.fetched_at);
      const updatedAtMs = parseIsoToMs(loaded.status.updated_at);
      return {
        source: loaded.status.source,
        source_version: loaded.status.sha256,
        provider_count: loaded.status.provider_count,
        model_count: loaded.status.model_count,
        fetched_at: loaded.status.fetched_at,
        updated_at: loaded.status.updated_at,
        fetched_age_ms: fetchedAtMs === null ? null : Math.max(0, nowMs - fetchedAtMs),
        cache_age_ms: updatedAtMs === null ? null : Math.max(0, nowMs - updatedAtMs),
        last_refresh_status: loaded.status.last_error ? "error" : "ok",
        last_error: loaded.status.last_error,
      };
    } catch {
      // Intentional: fall back to the DB snapshot when the in-memory service is unavailable.
    }
  }

  if (!db) return fallback;

  let row:
    | {
        source: string;
        fetched_at: string | null;
        updated_at: string;
        sha256: string;
        last_error: string | null;
        json: string;
      }
    | undefined;
  try {
    row = await db.get<{
      source: string;
      fetched_at: string | null;
      updated_at: string;
      sha256: string;
      last_error: string | null;
      json: string;
    }>(
      `SELECT source, fetched_at, updated_at, sha256, last_error, json
       FROM models_dev_cache
       WHERE id = 1`,
    );
  } catch (err) {
    if (isMissingTableError(err)) return fallback;
    throw err;
  }
  if (!row) return fallback;

  const counts = parseCatalogCounts(row.json);
  const fetchedAtMs = parseIsoToMs(row.fetched_at);
  const updatedAtMs = parseIsoToMs(row.updated_at);
  return {
    source: row.source,
    source_version: row.sha256,
    provider_count: counts.providerCount,
    model_count: counts.modelCount,
    fetched_at: row.fetched_at,
    updated_at: row.updated_at,
    fetched_age_ms: fetchedAtMs === null ? null : Math.max(0, nowMs - fetchedAtMs),
    cache_age_ms: updatedAtMs === null ? null : Math.max(0, nowMs - updatedAtMs),
    last_refresh_status: row.last_error ? "error" : "ok",
    last_error: row.last_error,
  };
}

export async function loadConversationLanes(
  db: SqlDb | undefined,
  tenantId: string,
): Promise<ConversationLaneStatus[]> {
  if (!db) return [];

  const nowMs = Date.now();
  let runs: Array<{
    key: string;
    lane: string;
    turn_id: string;
    status: string;
    created_at: string;
  }> = [];
  let queuedRows: Array<{ key: string; lane: string; queued_turns: number | string }> = [];
  let leases: Array<{
    key: string;
    lane: string;
    lease_owner: string;
    lease_expires_at_ms: number;
  }> = [];

  try {
    runs = await db.all<{
      key: string;
      lane: string;
      turn_id: string;
      status: string;
      created_at: string;
    }>(
      `SELECT conversation_key AS key,
              lane,
              turn_id,
              status,
              created_at
       FROM turns
       WHERE tenant_id = ?
         AND status IN ('queued', 'running', 'paused')
       ORDER BY created_at DESC, turn_id DESC
       LIMIT 500`,
      [tenantId],
    );
    queuedRows = await db.all<{ key: string; lane: string; queued_turns: number | string }>(
      `SELECT conversation_key AS key, lane, COUNT(*) AS queued_turns
       FROM turns
       WHERE tenant_id = ?
         AND status = 'queued'
       GROUP BY conversation_key, lane`,
      [tenantId],
    );
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }

  try {
    leases = await db.all<{
      key: string;
      lane: string;
      lease_owner: string;
      lease_expires_at_ms: number;
    }>(
      `SELECT conversation_key AS key, lane, lease_owner, lease_expires_at_ms
       FROM conversation_leases
       WHERE tenant_id = ?`,
      [tenantId],
    );
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }

  const keyFor = (key: string, lane: string): string => `${key}\u0000${lane}`;

  const latestRunByLane = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    const laneKey = keyFor(run.key, run.lane);
    if (!latestRunByLane.has(laneKey)) {
      latestRunByLane.set(laneKey, run);
    }
  }

  const queuedByLane = new Map<string, number>();
  for (const row of queuedRows) {
    queuedByLane.set(keyFor(row.key, row.lane), asFiniteNumber(row.queued_turns));
  }

  const leaseByLane = new Map<string, (typeof leases)[number]>();
  for (const lease of leases) {
    leaseByLane.set(keyFor(lease.key, lease.lane), lease);
  }

  const laneKeys = new Set<string>([
    ...latestRunByLane.keys(),
    ...queuedByLane.keys(),
    ...leaseByLane.keys(),
  ]);

  const lanes: ConversationLaneStatus[] = [];
  for (const laneKey of laneKeys) {
    const sep = laneKey.indexOf("\u0000");
    if (sep <= 0 || sep >= laneKey.length - 1) continue;
    const key = laneKey.slice(0, sep);
    const lane = laneKey.slice(sep + 1);
    const latestRun = latestRunByLane.get(laneKey);
    const lease = leaseByLane.get(laneKey);
    lanes.push({
      key,
      lane,
      latest_turn_id: latestRun?.turn_id ?? null,
      latest_turn_status: latestRun?.status ?? null,
      queued_turns: queuedByLane.get(laneKey) ?? 0,
      lease_owner: lease?.lease_owner ?? null,
      lease_expires_at_ms: lease?.lease_expires_at_ms ?? null,
      lease_active: Boolean(
        lease && Number.isFinite(lease.lease_expires_at_ms) && lease.lease_expires_at_ms > nowMs,
      ),
    });
  }

  return lanes.toSorted((a, b) => {
    const keyCmp = a.key.localeCompare(b.key);
    if (keyCmp !== 0) return keyCmp;
    return a.lane.localeCompare(b.lane);
  });
}

export async function loadQueueDepth(
  db: SqlDb | undefined,
  tenantId: string,
): Promise<QueueDepthStatus | null> {
  if (!db) return null;

  const emptyCounts = (statuses: readonly string[]): StatusCountMap =>
    Object.fromEntries(statuses.map((status) => [status, 0])) as StatusCountMap;

  const loadCounts = async (
    table: Parameters<typeof countByStatus>[2],
    statuses: readonly string[],
  ): Promise<{ counts: StatusCountMap; available: boolean }> => {
    try {
      return { counts: await countByStatus(db, tenantId, table, statuses), available: true };
    } catch (err) {
      if (isMissingTableError(err)) return { counts: emptyCounts(statuses), available: false };
      throw err;
    }
  };

  const [runsRes, jobsRes, inboxRes, outboxRes, firingsRes] = await Promise.all([
    loadCounts("turns", ["queued", "running", "paused"]),
    loadCounts("turn_jobs", ["queued", "running"]),
    loadCounts("channel_inbox", ["queued", "processing"]),
    loadCounts("channel_outbox", ["queued", "sending"]),
    loadCounts("watcher_firings", ["queued", "processing"]),
  ]);

  const anyAvailable =
    runsRes.available ||
    jobsRes.available ||
    inboxRes.available ||
    outboxRes.available ||
    firingsRes.available;
  if (!anyAvailable) return null;

  const runs = runsRes.counts;
  const jobs = jobsRes.counts;
  const inbox = inboxRes.counts;
  const outbox = outboxRes.counts;
  const firings = firingsRes.counts;

  return {
    turns: {
      queued: runs["queued"] ?? 0,
      running: runs["running"] ?? 0,
      paused: runs["paused"] ?? 0,
    },
    turn_jobs: { queued: jobs["queued"] ?? 0, running: jobs["running"] ?? 0 },
    channel_inbox: { queued: inbox["queued"] ?? 0, processing: inbox["processing"] ?? 0 },
    channel_outbox: { queued: outbox["queued"] ?? 0, sending: outbox["sending"] ?? 0 },
    watcher_firings: { queued: firings["queued"] ?? 0, processing: firings["processing"] ?? 0 },
    pending_total:
      (runs["queued"] ?? 0) +
      (jobs["queued"] ?? 0) +
      (inbox["queued"] ?? 0) +
      (outbox["queued"] ?? 0) +
      (firings["queued"] ?? 0),
    inflight_total:
      (runs["running"] ?? 0) +
      (runs["paused"] ?? 0) +
      (jobs["running"] ?? 0) +
      (inbox["processing"] ?? 0) +
      (outbox["sending"] ?? 0) +
      (firings["processing"] ?? 0),
  };
}
