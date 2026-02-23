import { isAuthProfilesEnabled } from "../models/auth-profiles-enabled.js";
import type { ModelsDevService } from "../models/models-dev-service.js";
import type { PolicyService } from "../policy/service.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { SqlDb } from "../../statestore/types.js";

type StatusCountMap = Record<string, number>;

type ActiveModelStatus = {
  model_id: string;
  provider: string | null;
  model: string | null;
  fallback_models: string[];
};

type AuthProfilesStatus = {
  enabled: boolean;
  total: number;
  active: number;
  disabled: number;
  cooldown_active: number;
  oauth_expired: number;
  oauth_expiring_within_24h: number;
  providers: string[];
  disabled_reasons: Array<{ reason: string; count: number }>;
  selected: {
    agent_id: string;
    session_id: string;
    provider: string;
    profile_id: string;
    updated_at: string;
  } | null;
};

type CatalogFreshnessStatus = {
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

type SessionLaneStatus = {
  key: string;
  lane: string;
  latest_run_id: string | null;
  latest_run_status: string | null;
  queued_runs: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  lease_active: boolean;
};

type QueueDepthStatus = {
  execution_runs: { queued: number; running: number; paused: number };
  execution_jobs: { queued: number; running: number };
  channel_inbox: { queued: number; processing: number };
  channel_outbox: { queued: number; sending: number };
  watcher_firings: { queued: number; processing: number };
  pending_total: number;
  inflight_total: number;
};

type SandboxStatus = {
  mode: "disabled" | "observe" | "enforce";
  policy_enabled: boolean;
  policy_observe_only: boolean;
  effective_policy_sha256: string;
  elevated_execution_available: boolean | null;
};

export interface StatusDetails {
  model_auth: {
    active_model: ActiveModelStatus | null;
    auth_profiles: AuthProfilesStatus | null;
  };
  catalog_freshness: CatalogFreshnessStatus;
  session_lanes: SessionLaneStatus[];
  queue_depth: QueueDepthStatus | null;
  sandbox: SandboxStatus | null;
}

export interface StatusDetailsDeps {
  db?: SqlDb;
  policyService?: PolicyService;
  policyStatus?: { enabled: boolean; observe_only: boolean; effective_sha256: string };
  agents?: AgentRegistry;
  modelsDev?: ModelsDevService;
}

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
    return { providerCount: 0, modelCount: 0 };
  }
}

async function countByStatus(
  db: SqlDb,
  table: "execution_runs" | "execution_jobs" | "channel_inbox" | "channel_outbox" | "watcher_firings",
  statuses: readonly string[],
): Promise<StatusCountMap> {
  const counts = Object.fromEntries(statuses.map((s) => [s, 0])) as StatusCountMap;
  const placeholders = statuses.map(() => "?").join(", ");
  const rows = await db.all<{ status: string; count: number | string }>(
    `SELECT status, COUNT(*) AS count
     FROM ${table}
     WHERE status IN (${placeholders})
     GROUP BY status`,
    statuses,
  );
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(counts, row.status)) {
      counts[row.status] = asFiniteNumber(row.count);
    }
  }
  return counts;
}

async function loadActiveModel(agents: AgentRegistry | undefined): Promise<ActiveModelStatus | null> {
  if (!agents) return null;

  try {
    const runtime = await agents.getRuntime("default");
    const status = await runtime.status(true);
    const modelId = status.model.model;
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
    return null;
  }
}

async function loadAuthProfileHealth(db: SqlDb | undefined): Promise<AuthProfilesStatus | null> {
  if (!db) return null;

  const profiles = await db.all<{
    profile_id: string;
    agent_id: string;
    provider: string;
    type: string;
    status: string;
    disabled_reason: string | null;
    cooldown_until_ms: number | null;
    expires_at: string | null;
  }>(
    `SELECT
       profile_id,
       agent_id,
       provider,
       type,
       status,
       disabled_reason,
       cooldown_until_ms,
       expires_at
     FROM auth_profiles
     ORDER BY updated_at DESC
     LIMIT 500`,
  );

  const pins = await db.all<{
    agent_id: string;
    session_id: string;
    provider: string;
    profile_id: string;
    updated_at: string;
  }>(
    `SELECT
       agent_id,
       session_id,
       provider,
       profile_id,
       updated_at
     FROM session_provider_pins
     ORDER BY updated_at DESC
     LIMIT 500`,
  );

  const nowMs = Date.now();
  const soonMs = nowMs + 24 * 60 * 60 * 1000;
  const active = profiles.filter((p) => p.status === "active");
  const disabled = profiles.filter((p) => p.status === "disabled");
  const cooldownActive = active.filter(
    (p) =>
      typeof p.cooldown_until_ms === "number" &&
      Number.isFinite(p.cooldown_until_ms) &&
      p.cooldown_until_ms > nowMs,
  ).length;
  const oauthActive = active.filter((p) => p.type === "oauth");
  const oauthExpired = oauthActive.filter((p) => {
    const expiresMs = parseIsoToMs(p.expires_at);
    return expiresMs !== null && expiresMs <= nowMs;
  }).length;
  const oauthExpiringSoon = oauthActive.filter((p) => {
    const expiresMs = parseIsoToMs(p.expires_at);
    return expiresMs !== null && expiresMs > nowMs && expiresMs <= soonMs;
  }).length;

  const disabledReasonsMap = new Map<string, number>();
  for (const profile of disabled) {
    const reason = profile.disabled_reason?.trim() || "unspecified";
    disabledReasonsMap.set(reason, (disabledReasonsMap.get(reason) ?? 0) + 1);
  }
  const disabledReasons = [...disabledReasonsMap.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => a.reason.localeCompare(b.reason));

  const providers = [...new Set(profiles.map((p) => p.provider))]
    .filter((provider) => provider.trim().length > 0)
    .sort();

  const selectedPin = pins[0];

  return {
    enabled: isAuthProfilesEnabled(),
    total: profiles.length,
    active: active.length,
    disabled: disabled.length,
    cooldown_active: cooldownActive,
    oauth_expired: oauthExpired,
    oauth_expiring_within_24h: oauthExpiringSoon,
    providers,
    disabled_reasons: disabledReasons,
    selected: selectedPin
      ? {
          agent_id: selectedPin.agent_id,
          session_id: selectedPin.session_id,
          provider: selectedPin.provider,
          profile_id: selectedPin.profile_id,
          updated_at: selectedPin.updated_at,
        }
      : null,
  };
}

async function loadCatalogFreshness(
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
      // Fall through to DB fallback below.
    }
  }

  if (!db) return fallback;

  const row = await db.get<{
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

async function loadSessionLanes(db: SqlDb | undefined): Promise<SessionLaneStatus[]> {
  if (!db) return [];

  const nowMs = Date.now();
  const runs = await db.all<{
    key: string;
    lane: string;
    run_id: string;
    status: string;
    created_at: string;
  }>(
    `SELECT key, lane, run_id, status, created_at
     FROM execution_runs
     WHERE status IN ('queued', 'running', 'paused')
     ORDER BY created_at DESC, run_id DESC
     LIMIT 500`,
  );
  const queuedRows = await db.all<{ key: string; lane: string; queued_runs: number | string }>(
    `SELECT key, lane, COUNT(*) AS queued_runs
     FROM execution_runs
     WHERE status = 'queued'
     GROUP BY key, lane`,
  );
  const leases = await db.all<{
    key: string;
    lane: string;
    lease_owner: string;
    lease_expires_at_ms: number;
  }>(
    `SELECT key, lane, lease_owner, lease_expires_at_ms
     FROM lane_leases`,
  );

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
    queuedByLane.set(keyFor(row.key, row.lane), asFiniteNumber(row.queued_runs));
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

  const lanes: SessionLaneStatus[] = [];
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
      latest_run_id: latestRun?.run_id ?? null,
      latest_run_status: latestRun?.status ?? null,
      queued_runs: queuedByLane.get(laneKey) ?? 0,
      lease_owner: lease?.lease_owner ?? null,
      lease_expires_at_ms: lease?.lease_expires_at_ms ?? null,
      lease_active: Boolean(
        lease &&
          Number.isFinite(lease.lease_expires_at_ms) &&
          lease.lease_expires_at_ms > nowMs,
      ),
    });
  }

  return lanes.sort((a, b) => {
    const keyCmp = a.key.localeCompare(b.key);
    if (keyCmp !== 0) return keyCmp;
    return a.lane.localeCompare(b.lane);
  });
}

async function loadQueueDepth(db: SqlDb | undefined): Promise<QueueDepthStatus | null> {
  if (!db) return null;

  const [runs, jobs, inbox, outbox, firings] = await Promise.all([
    countByStatus(db, "execution_runs", ["queued", "running", "paused"]),
    countByStatus(db, "execution_jobs", ["queued", "running"]),
    countByStatus(db, "channel_inbox", ["queued", "processing"]),
    countByStatus(db, "channel_outbox", ["queued", "sending"]),
    countByStatus(db, "watcher_firings", ["queued", "processing"]),
  ]);

  return {
    execution_runs: {
      queued: runs["queued"] ?? 0,
      running: runs["running"] ?? 0,
      paused: runs["paused"] ?? 0,
    },
    execution_jobs: {
      queued: jobs["queued"] ?? 0,
      running: jobs["running"] ?? 0,
    },
    channel_inbox: {
      queued: inbox["queued"] ?? 0,
      processing: inbox["processing"] ?? 0,
    },
    channel_outbox: {
      queued: outbox["queued"] ?? 0,
      sending: outbox["sending"] ?? 0,
    },
    watcher_firings: {
      queued: firings["queued"] ?? 0,
      processing: firings["processing"] ?? 0,
    },
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

async function loadSandboxStatus(
  policyService: PolicyService | undefined,
  policyStatus?: { enabled: boolean; observe_only: boolean; effective_sha256: string },
): Promise<SandboxStatus | null> {
  if (!policyService) return null;

  const status = policyStatus ?? (await policyService.getStatus());
  const mode: SandboxStatus["mode"] = !status.enabled
    ? "disabled"
    : status.observe_only
      ? "observe"
      : "enforce";

  let elevatedExecutionAvailable: boolean | null = null;
  try {
    const effective = await policyService.loadEffectiveBundle();
    const tools = effective.bundle.tools;
    const toolsDefault = tools?.default ?? "deny";
    const allowCount = Array.isArray(tools?.allow) ? tools.allow.length : 0;
    const requireApprovalCount = Array.isArray(tools?.require_approval)
      ? tools.require_approval.length
      : 0;
    elevatedExecutionAvailable =
      toolsDefault !== "deny" || allowCount > 0 || requireApprovalCount > 0;
  } catch {
    elevatedExecutionAvailable = null;
  }

  return {
    mode,
    policy_enabled: status.enabled,
    policy_observe_only: status.observe_only,
    effective_policy_sha256: status.effective_sha256,
    elevated_execution_available: elevatedExecutionAvailable,
  };
}

export async function buildStatusDetails(deps: StatusDetailsDeps): Promise<StatusDetails> {
  const [activeModel, authProfiles, catalog, sessionLanes, queueDepth, sandbox] =
    await Promise.all([
      loadActiveModel(deps.agents),
      loadAuthProfileHealth(deps.db),
      loadCatalogFreshness(deps.db, deps.modelsDev),
      loadSessionLanes(deps.db),
      loadQueueDepth(deps.db),
      loadSandboxStatus(deps.policyService, deps.policyStatus),
    ]);

  return {
    model_auth: {
      active_model: activeModel,
      auth_profiles: authProfiles,
    },
    catalog_freshness: catalog,
    session_lanes: sessionLanes,
    queue_depth: queueDepth,
    sandbox,
  };
}
