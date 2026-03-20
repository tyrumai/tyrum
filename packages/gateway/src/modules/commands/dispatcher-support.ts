import { AttemptCost, parseTyrumKey } from "@tyrum/contracts";
import { buildStatusDetails } from "../observability/status-details.js";
import { AuthProfileDal } from "../models/auth-profile-dal.js";
import { SessionProviderPinDal } from "../models/session-pin-dal.js";
import { ProviderUsagePoller } from "../observability/provider-usage.js";
import { SessionDal } from "../agent/session-dal.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal, requirePrimaryAgentKey } from "../identity/scope.js";
import { ChannelThreadDal } from "../channels/thread-dal.js";
import { DEFAULT_CHANNEL_ACCOUNT_ID, parseChannelSourceKey } from "../channels/interface.js";
import { resolveWorkspaceKey } from "../workspace/id.js";
import { buildAgentTurnKey, encodeTurnKeyPart } from "../agent/turn-key.js";
import { ExecutionEngine } from "../execution/engine.js";
import type { SqlDb } from "../../statestore/types.js";
import type { CommandDeps } from "./dispatcher.js";

type UsageTotals = {
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  usd_micros: number;
};

export function tokensFromCommand(raw: string): string[] {
  const line = raw.trim();
  if (line.length === 0) return [];
  const normalized = line.startsWith("/") ? line.slice(1) : line;
  const trimmed = normalized.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(/\s+/g).filter((t) => t.length > 0);
}

export function jsonBlock(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

export function helpText(): string {
  return [
    "Available commands:",
    "- /help",
    "- /new",
    "- /reset",
    "- /stop",
    "- /compact",
    "- /status",
    "- /presence",
    "- /approvals [queued|reviewing|awaiting_human|approved|denied|expired|cancelled]",
    "- /pairings [queued|reviewing|awaiting_human|approved|denied|revoked]",
    "- /model [preset_key|provider/model[@profile]]",
    "- /intake [auto|inline|delegate_execute|delegate_plan]",
    "- /queue [collect|followup|steer|steer_backlog|interrupt]",
    "- /send [on|off|inherit]",
    "- /policy bundle",
    "- /policy overrides list [agent_id] [tool_id] [status]",
    "- /policy overrides describe <policy_override_id>",
    "- /policy overrides revoke <policy_override_id> [reason...]",
    "- /context last",
    "- /context list [limit]",
    "- /context detail <context_report_id>",
    "- /usage [run_id]",
    "- /usage provider",
    "",
    "Notes:",
    "- Commands are handled by the gateway (not the model).",
    "- Some commands require session context (channel/thread_id or key/lane).",
    "- Some commands require optional subsystems (presence, policy, etc.).",
  ].join("\n");
}

export function formatUsageTotals(value: unknown): string {
  if (!value || typeof value !== "object") return "No usage data available.";
  return jsonBlock(value);
}

function isLegacyConfiguredPresetKey(presetKey: string): boolean {
  return presetKey.trim().toLowerCase().startsWith("legacy-");
}

export function isLegacyPresetKey(presetKey: string): boolean {
  return isLegacyConfiguredPresetKey(presetKey);
}

export function createSessionDal(db: SqlDb): SessionDal {
  return new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
}

export function resolveTenantId(deps: CommandDeps): string {
  return deps.tenantId?.trim() || DEFAULT_TENANT_ID;
}

export class CommandContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandContextError";
  }
}

export async function getProviderUsagePoller(
  deps: CommandDeps,
): Promise<ProviderUsagePoller | undefined> {
  if (!deps.db || !deps.agents) return undefined;
  const tenantId = resolveTenantId(deps);
  const agentId = await resolveAgentId(deps.commandContext, {
    tenantId,
    identityScopeDal: new IdentityScopeDal(deps.db),
  });
  return new ProviderUsagePoller({
    authProfileDal: new AuthProfileDal(deps.db),
    pinDal: new SessionProviderPinDal(deps.db),
    secretProviderGetter: async () => deps.agents!.getSecretProvider(tenantId, agentId),
    fetchImpl: deps.fetchImpl,
  });
}

export async function resolveAgentId(
  ctx: CommandDeps["commandContext"] | undefined,
  options?: { tenantId?: string; identityScopeDal?: IdentityScopeDal },
): Promise<string> {
  const explicit = ctx?.agentId?.trim();
  if (explicit) return explicit;

  const key = ctx?.key?.trim();
  if (key) {
    try {
      const parsed = parseTyrumKey(key as never);
      if (parsed.kind === "agent") return parsed.agent_key;
    } catch {
      throw new CommandContextError("Invalid session key in command context.");
    }
  }

  if (options?.tenantId && options.identityScopeDal) {
    try {
      return await requirePrimaryAgentKey(options.identityScopeDal, options.tenantId);
    } catch {
      throw new CommandContextError("No primary agent is configured for this tenant.");
    }
  }

  throw new CommandContextError("Agent context is required for this command.");
}

export function buildDefaultCommandKey(input: {
  agentId: string;
  channel: string;
  threadId: string;
}): string {
  const workspaceId = resolveWorkspaceKey();
  return buildAgentTurnKey({
    agentId: input.agentId,
    workspaceId,
    channel: input.channel.trim(),
    containerKind: "channel",
    threadId: input.threadId.trim(),
  });
}

function escapeLikePattern(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

async function resolveStoredKeyLaneByChannelThread(
  db: SqlDb,
  input: { agentId: string; channel: string; threadId: string },
): Promise<{ key: string; lane: string } | undefined> {
  const safeAgentId = escapeLikePattern(encodeTurnKeyPart(input.agentId.trim()));
  const safeChannel = escapeLikePattern(encodeTurnKeyPart(input.channel.trim()));
  const safeThread = escapeLikePattern(encodeTurnKeyPart(input.threadId.trim()));
  const keyPattern = `agent:${safeAgentId}:${safeChannel}:%:%:${safeThread}`;

  const runRow = await db.get<{ key: string; lane: string }>(
    `SELECT key, lane
     FROM execution_runs
     WHERE key LIKE ? ESCAPE '\\'
     ORDER BY created_at DESC
     LIMIT 1`,
    [keyPattern],
  );
  if (runRow?.key) return runRow;

  const queueRow = await db.get<{ key: string; lane: string }>(
    `SELECT key, lane
     FROM lane_queue_mode_overrides
     WHERE key LIKE ? ESCAPE '\\'
     ORDER BY updated_at_ms DESC
     LIMIT 1`,
    [keyPattern],
  );
  if (queueRow?.key) return queueRow;

  const sendRow = await db.get<{ key: string }>(
    `SELECT key
     FROM session_send_policy_overrides
     WHERE key LIKE ? ESCAPE '\\'
     ORDER BY updated_at_ms DESC
     LIMIT 1`,
    [keyPattern],
  );
  if (sendRow?.key) return { key: sendRow.key, lane: "main" };

  return undefined;
}

export async function resolveKeyLane(
  db: SqlDb,
  ctx: CommandDeps["commandContext"] | undefined,
): Promise<{ key: string; lane: string } | undefined> {
  const key = ctx?.key?.trim();
  const lane = ctx?.lane?.trim() || "main";
  if (key) return { key, lane };

  const channel = ctx?.channel?.trim();
  const threadId = ctx?.threadId?.trim();
  if (!channel || !threadId) return undefined;

  const agentId = ctx?.agentId?.trim();
  const agentKeyPrefix = agentId ? `agent:${agentId}:` : undefined;
  const sources: Array<{ exact: string; like?: string }> = [
    { exact: channel, like: `${channel}:%` },
  ];
  if (channel.includes(":")) {
    try {
      const parsed = parseChannelSourceKey(channel);
      if (parsed.accountId === "default") sources.push({ exact: parsed.connector });
    } catch {
      // Intentional: ignore parse errors; fall back to matching the provided channel only.
    }
  }

  const sourceClause = sources
    .map((entry) => (entry.like ? "(source = ? OR source LIKE ?)" : "(source = ?)"))
    .join(" OR ");
  const sourceArgs = sources.flatMap((entry) =>
    entry.like ? [entry.exact, entry.like] : [entry.exact],
  );
  const row = await db.get<{ key: string; lane: string }>(
    `SELECT key, lane
     FROM channel_inbox
     WHERE thread_id = ?
       AND (${sourceClause})
       ${agentKeyPrefix ? "AND substr(key, 1, ?) = ?" : ""}
     ORDER BY received_at_ms DESC, inbox_id DESC
     LIMIT 1`,
    agentKeyPrefix
      ? [threadId, ...sourceArgs, agentKeyPrefix.length, agentKeyPrefix]
      : [threadId, ...sourceArgs],
  );
  if (!row?.key) return undefined;
  return { key: row.key, lane: row.lane };
}

export async function resolveFallbackKeyLane(
  db: SqlDb,
  ctx: CommandDeps["commandContext"] | undefined,
  agentId: string,
): Promise<{ key: string; lane: string } | undefined> {
  const channelThread = await resolveChannelThread(db, ctx);
  if (!channelThread) return undefined;

  const existing = await resolveStoredKeyLaneByChannelThread(db, {
    agentId,
    channel: channelThread.channel,
    threadId: channelThread.threadId,
  });
  if (existing) return existing;

  return {
    key: buildDefaultCommandKey({
      agentId,
      channel: channelThread.channel,
      threadId: channelThread.threadId,
    }),
    lane: "main",
  };
}

export function resolveContainerKindFromSessionKey(
  key: string | undefined,
): "dm" | "group" | "channel" {
  if (!key) return "channel";
  try {
    const parsed = parseTyrumKey(key as never);
    if (
      parsed.kind === "agent" &&
      (parsed.thread_kind === "dm" ||
        parsed.thread_kind === "group" ||
        parsed.thread_kind === "channel")
    ) {
      return parsed.thread_kind;
    }
  } catch {
    // Intentional: fall back to channel-scoped sessions for legacy/unknown keys.
  }
  return "channel";
}

export async function cancelRunsAndClearQueuedInbox(input: {
  db: SqlDb;
  policyService: CommandDeps["policyService"];
  key: string;
  lane: string;
  runReason: string;
  inboxReason: string;
}): Promise<{ cancelledRuns: number; clearedInbox: number }> {
  const engine = new ExecutionEngine({
    db: input.db,
    policyService: input.policyService,
    eventsEnabled: true,
  });
  const activeRuns = await input.db.all<{ run_id: string }>(
    `SELECT run_id
     FROM execution_runs
     WHERE key = ? AND lane = ? AND status IN ('queued', 'running', 'paused')
     ORDER BY created_at DESC`,
    [input.key, input.lane],
  );

  let cancelledRuns = 0;
  for (const row of activeRuns) {
    const status = await engine.cancelRun(row.run_id, input.runReason);
    if (status === "cancelled") cancelledRuns += 1;
  }

  const nowIso = new Date().toISOString();
  const cleared = await input.db.run(
    `UPDATE channel_inbox
     SET status = 'failed',
         lease_owner = NULL,
         lease_expires_at_ms = NULL,
         processed_at = COALESCE(processed_at, ?),
         error = COALESCE(error, ?),
         reply_text = COALESCE(reply_text, '')
     WHERE status = 'queued' AND key = ? AND lane = ?`,
    [nowIso, input.inboxReason, input.key, input.lane],
  );

  return { cancelledRuns, clearedInbox: cleared.changes };
}

export async function resolveChannelThread(
  db: SqlDb,
  ctx: CommandDeps["commandContext"] | undefined,
): Promise<{ channel: string; accountKey?: string; threadId: string } | undefined> {
  const resolveChannelAddress = (
    sourceRaw: string,
  ): { channel: string; accountKey?: string } | undefined => {
    const source = sourceRaw.trim();
    if (!source) return undefined;

    try {
      const parsed = parseChannelSourceKey(source);
      return {
        channel: parsed.connector,
        accountKey: parsed.accountId === DEFAULT_CHANNEL_ACCOUNT_ID ? undefined : parsed.accountId,
      };
    } catch {
      // Intentional: accept unscoped channel IDs by stripping any connector suffix.
      const idx = source.indexOf(":");
      const channel = (idx > 0 ? source.slice(0, idx) : source).trim();
      if (!channel) return undefined;
      return { channel };
    }
  };

  const channelRaw = ctx?.channel?.trim();
  const threadIdRaw = ctx?.threadId?.trim();
  if (channelRaw && threadIdRaw) {
    const resolved = resolveChannelAddress(channelRaw);
    if (!resolved) return undefined;
    return { ...resolved, threadId: threadIdRaw };
  }

  const key = ctx?.key?.trim();
  const lane = ctx?.lane?.trim() || "main";
  if (!key) return undefined;

  const row = await db.get<{ source: string; thread_id: string }>(
    `SELECT source, thread_id
     FROM channel_inbox
     WHERE key = ? AND lane = ?
     ORDER BY received_at_ms DESC, inbox_id DESC
     LIMIT 1`,
    [key, lane],
  );
  if (row?.source && row?.thread_id) {
    const resolved = resolveChannelAddress(row.source);
    if (!resolved) return undefined;
    const threadId = row.thread_id.trim();
    if (!threadId) return undefined;
    return { ...resolved, threadId };
  }

  try {
    const parsed = parseTyrumKey(key as never);
    if (parsed.kind === "agent" && "channel" in parsed && "id" in parsed) {
      const channel = String(parsed.channel).trim();
      const account =
        "account" in parsed ? String(parsed.account).trim() : DEFAULT_CHANNEL_ACCOUNT_ID;
      const accountKey = account && account !== DEFAULT_CHANNEL_ACCOUNT_ID ? account : undefined;
      const threadId = String(parsed.id).trim();
      if (channel && threadId) return { channel, accountKey, threadId };
    }
  } catch {
    // Intentional: ignore parse errors when resolving channel/thread from legacy keys.
  }

  return undefined;
}

function addOptional(total: number, value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? total + value : total;
}

function newTotals(): UsageTotals {
  return { duration_ms: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, usd_micros: 0 };
}

export async function computeUsageTotals(
  db: SqlDb,
  runId?: string,
): Promise<{
  attempts_total_with_cost: number;
  attempts_parsed: number;
  attempts_invalid: number;
  totals: UsageTotals;
}> {
  const rows = runId
    ? await db.all<{ cost_json: string | null }>(
        `SELECT a.cost_json
         FROM execution_attempts a
         JOIN execution_steps s ON s.step_id = a.step_id
         WHERE s.run_id = ?
           AND a.cost_json IS NOT NULL`,
        [runId],
      )
    : await db.all<{ cost_json: string | null }>(
        `SELECT cost_json
         FROM execution_attempts
         WHERE cost_json IS NOT NULL`,
      );

  const totals = newTotals();
  let parsed = 0;
  let invalid = 0;
  for (const row of rows) {
    if (!row.cost_json) continue;

    let json: unknown;
    try {
      json = JSON.parse(row.cost_json) as unknown;
    } catch {
      // Intentional: malformed stored cost payloads are skipped in aggregate reporting.
      invalid += 1;
      continue;
    }

    const cost = AttemptCost.safeParse(json);
    if (!cost.success) {
      invalid += 1;
      continue;
    }

    parsed += 1;
    totals.duration_ms = addOptional(totals.duration_ms, cost.data.duration_ms);
    totals.input_tokens = addOptional(totals.input_tokens, cost.data.input_tokens);
    totals.output_tokens = addOptional(totals.output_tokens, cost.data.output_tokens);
    totals.total_tokens = addOptional(totals.total_tokens, cost.data.total_tokens);
    totals.usd_micros = addOptional(totals.usd_micros, cost.data.usd_micros);
  }

  return {
    attempts_total_with_cost: rows.length,
    attempts_parsed: parsed,
    attempts_invalid: invalid,
    totals,
  };
}

export async function buildStatusPayload(deps: CommandDeps): Promise<{
  status: string;
  runtime: CommandDeps["runtime"] | null;
  auth: { enabled: boolean };
  ws: ReturnType<NonNullable<CommandDeps["connectionManager"]>["getStats"]> | null;
  policy: Awaited<ReturnType<NonNullable<CommandDeps["policyService"]>["getStatus"]>> | null;
  model_auth: unknown;
  catalog_freshness: unknown;
  session_lanes: unknown;
  queue_depth: unknown;
  sandbox: unknown;
  config_health: unknown;
}> {
  const tenantId = resolveTenantId(deps);
  const policy = deps.policyService ? await deps.policyService.getStatus({ tenantId }) : null;
  const details = await buildStatusDetails({
    tenantId,
    db: deps.db,
    policyService: deps.policyService,
    policyStatus: policy
      ? {
          observe_only: policy.observe_only,
          effective_sha256: policy.effective_sha256,
        }
      : undefined,
    toolrunnerHardeningProfile: deps.runtime?.toolrunnerHardeningProfile,
    agents: deps.agents,
    modelsDev: deps.modelsDev,
  });
  return {
    status: "ok",
    runtime: deps.runtime ?? null,
    auth: { enabled: deps.runtime?.authEnabled ?? false },
    ws: deps.connectionManager?.getStats() ?? null,
    policy,
    model_auth: details.model_auth,
    catalog_freshness: details.catalog_freshness,
    session_lanes: details.session_lanes,
    queue_depth: details.queue_depth,
    sandbox: details.sandbox,
    config_health: details.config_health,
  };
}
