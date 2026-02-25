import { AttemptCost, parseTyrumKey } from "@tyrum/schemas";
import type { SqlDb, StateStoreKind } from "../../statestore/types.js";
import type { ConnectionManager } from "../../ws/connection-manager.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { PresenceDal } from "../presence/dal.js";
import type { NodePairingDal } from "../node/pairing-dal.js";
import type { PolicyService } from "../policy/service.js";
import type { PolicyOverrideDal } from "../policy/override-dal.js";
import type { ContextReportDal } from "../context/report-dal.js";
import type { PluginRegistry } from "../plugins/registry.js";
import type { ModelsDevService } from "../models/models-dev-service.js";
import type { AgentRegistry } from "../agent/registry.js";
import { buildStatusDetails } from "../observability/status-details.js";
import { AuthProfileDal } from "../models/auth-profile-dal.js";
import { SessionProviderPinDal } from "../models/session-pin-dal.js";
import { ProviderUsagePoller } from "../observability/provider-usage.js";
import { SessionDal } from "../agent/session-dal.js";
import { SessionModelOverrideDal } from "../models/session-model-override-dal.js";
import { isAuthProfilesEnabled } from "../models/auth-profiles-enabled.js";
import { LaneQueueModeOverrideDal } from "../lanes/queue-mode-override-dal.js";
import { SessionSendPolicyOverrideDal } from "../channels/send-policy-override-dal.js";
import { parseChannelSourceKey } from "../channels/interface.js";
import { resolveWorkspaceId } from "../workspace/id.js";
import { buildAgentTurnKey, encodeTurnKeyPart } from "../agent/turn-key.js";
import { randomUUID } from "node:crypto";
import { ExecutionEngine } from "../execution/engine.js";

export type CommandExecuteResult = {
  output: string;
  data?: unknown;
};

export interface CommandDeps {
  runtime?: {
    version: string;
    instanceId: string;
    role: string;
    dbKind: StateStoreKind;
    isExposed: boolean;
    otelEnabled: boolean;
  };
  commandContext?: {
    agentId?: string;
    channel?: string;
    threadId?: string;
    key?: string;
    lane?: string;
  };
  connectionManager?: ConnectionManager;
  db?: SqlDb;
  approvalDal?: ApprovalDal;
  presenceDal?: PresenceDal;
  nodePairingDal?: NodePairingDal;
  policyService?: PolicyService;
  policyOverrideDal?: PolicyOverrideDal;
  contextReportDal?: ContextReportDal;
  plugins?: PluginRegistry;
  modelsDev?: ModelsDevService;
  agents?: AgentRegistry;
  fetchImpl?: typeof fetch;
}

const DEFAULT_PROVIDER_USAGE_FETCH_KEY = Symbol("default-provider-usage-fetch");

const providerUsagePollers = new WeakMap<SqlDb, WeakMap<AgentRegistry, Map<unknown, ProviderUsagePoller>>>();

function getProviderUsagePoller(deps: CommandDeps): ProviderUsagePoller | undefined {
  if (!deps.db || !deps.agents) return undefined;

  let byAgents = providerUsagePollers.get(deps.db);
  if (!byAgents) {
    byAgents = new WeakMap();
    providerUsagePollers.set(deps.db, byAgents);
  }

  let byFetch = byAgents.get(deps.agents);
  if (!byFetch) {
    byFetch = new Map();
    byAgents.set(deps.agents, byFetch);
  }

  const fetchKey = deps.fetchImpl ?? DEFAULT_PROVIDER_USAGE_FETCH_KEY;
  let poller = byFetch.get(fetchKey);
  if (!poller) {
    poller = new ProviderUsagePoller({
      authProfileDal: new AuthProfileDal(deps.db),
      pinDal: new SessionProviderPinDal(deps.db),
      agents: deps.agents,
      fetchImpl: deps.fetchImpl,
    });
    byFetch.set(fetchKey, poller);
  }
  return poller;
}

function tokensFromCommand(raw: string): string[] {
  const line = raw.trim();
  if (line.length === 0) return [];
  const normalized = line.startsWith("/") ? line.slice(1) : line;
  const trimmed = normalized.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(/\s+/g).filter((t) => t.length > 0);
}

function jsonBlock(value: unknown): string {
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

function formatUsageTotals(value: unknown): string {
  if (!value || typeof value !== "object") return "No usage data available.";
  return jsonBlock(value);
}

type UsageTotals = {
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  usd_micros: number;
};

async function resolveKeyLane(db: SqlDb, ctx: CommandDeps["commandContext"] | undefined): Promise<{ key: string; lane: string } | undefined> {
  const key = ctx?.key?.trim();
  const lane = ctx?.lane?.trim() || "main";
  if (key) return { key, lane };

  const channel = ctx?.channel?.trim();
  const threadId = ctx?.threadId?.trim();
  if (!channel || !threadId) return undefined;

  const agentId = ctx?.agentId?.trim();
  const agentKeyPrefix = agentId ? `agent:${agentId}:` : undefined;

  const sources: Array<{ exact: string; like?: string }> = [{ exact: channel, like: `${channel}:%` }];
  if (channel.includes(":")) {
    try {
      const parsed = parseChannelSourceKey(channel);
      if (parsed.accountId === "default") {
        sources.push({ exact: parsed.connector });
      }
    } catch {
      // ignore parse errors; fall back to matching the provided channel only
    }
  }

  const sourceClause = sources.map((entry) => (entry.like ? "(source = ? OR source LIKE ?)" : "(source = ?)")).join(" OR ");
  const sourceArgs = sources.flatMap((entry) => (entry.like ? [entry.exact, entry.like] : [entry.exact]));

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

function resolveAgentId(ctx: CommandDeps["commandContext"] | undefined): string {
  const explicit = ctx?.agentId?.trim();
  if (explicit) return explicit;

  const key = ctx?.key?.trim();
  if (key) {
    try {
      const parsed = parseTyrumKey(key as never);
      if (parsed.kind === "agent") return parsed.agent_id;
    } catch {
      // ignore invalid keys; fall back to default agent
    }
  }

  return "default";
}

function buildDefaultCommandKey(input: {
  agentId: string;
  channel: string;
  threadId: string;
}): string {
  const workspaceId = resolveWorkspaceId();
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

async function resolveFallbackKeyLane(
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

async function cancelRunsAndClearQueuedInbox(input: {
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

async function resolveChannelThread(db: SqlDb, ctx: CommandDeps["commandContext"] | undefined): Promise<{ channel: string; threadId: string } | undefined> {
  const channelRaw = ctx?.channel?.trim();
  const threadIdRaw = ctx?.threadId?.trim();
  if (channelRaw && threadIdRaw) {
    let channel = channelRaw;
    try {
      channel = parseChannelSourceKey(channelRaw).connector;
    } catch {
      const idx = channel.indexOf(":");
      if (idx > 0) channel = channel.slice(0, idx);
    }
    return { channel, threadId: threadIdRaw };
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
    let channel = row.source.trim();
    try {
      channel = parseChannelSourceKey(channel).connector;
    } catch {
      const idx = channel.indexOf(":");
      if (idx > 0) channel = channel.slice(0, idx);
    }
    const threadId = row.thread_id.trim();
    if (!channel || !threadId) return undefined;
    return { channel, threadId };
  }

  try {
    const parsed = parseTyrumKey(key as never);
    if (parsed.kind === "agent" && "channel" in parsed && "id" in parsed) {
      const channel = String(parsed.channel).trim();
      const threadId = String(parsed.id).trim();
      if (channel && threadId) return { channel, threadId };
    }
  } catch {
    // ignore parse errors
  }

  return undefined;
}

function addOptional(total: number, value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? total + value : total;
}

function newTotals(): UsageTotals {
  return {
    duration_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    usd_micros: 0,
  };
}

async function computeUsageTotals(db: SqlDb, runId?: string): Promise<{
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

function helpText(): string {
  return [
    "Available commands:",
    "- /help",
    "- /new",
    "- /reset",
    "- /stop",
    "- /compact",
    "- /status",
    "- /presence",
    "- /approvals [pending|approved|denied|expired]",
    "- /pairings [pending|approved|denied|revoked]",
    "- /model [provider/model[@profile]]",
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

export async function executeCommand(raw: string, deps: CommandDeps): Promise<CommandExecuteResult> {
  const toks = tokensFromCommand(raw);
  const cmd = toks[0]?.toLowerCase() ?? "help";

  if (cmd === "help" || cmd === "?") {
    return { output: helpText(), data: { commands: helpText() } };
  }

  if (cmd === "new") {
    if (!deps.db) {
      return { output: "Sessions are not available on this gateway instance.", data: null };
    }

    const ctx = deps.commandContext;
    const agentId = resolveAgentId(ctx);
    const channelRaw = ctx?.channel?.trim();
    if (!channelRaw) {
      return { output: "Usage: /new (requires channel context)", data: null };
    }

    let channel = channelRaw;
    try {
      channel = parseChannelSourceKey(channelRaw).connector;
    } catch {
      const idx = channel.indexOf(":");
      if (idx > 0) channel = channel.slice(0, idx);
    }
    if (!channel) {
      return { output: "Usage: /new (requires channel context)", data: null };
    }

    const threadId = `${channel}-${randomUUID()}`;
    const sessionDal = new SessionDal(deps.db);
    const session = await sessionDal.getOrCreate(channel, threadId, agentId);

    const payload = {
      agent_id: agentId,
      channel,
      thread_id: threadId,
      session_id: session.session_id,
    };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "compact") {
    if (!deps.db) {
      return { output: "Sessions are not available on this gateway instance.", data: null };
    }

    const ctx = deps.commandContext;
    const agentId = resolveAgentId(ctx);
    const resolved = await resolveChannelThread(deps.db, ctx);
    if (!resolved) {
      return { output: "Usage: /compact (requires key or channel/thread context)", data: null };
    }
    const { channel, threadId } = resolved;

    const sessionDal = new SessionDal(deps.db);
    const session = await sessionDal.getOrCreate(channel, threadId, agentId);
    const compacted = await sessionDal.compact({ sessionId: session.session_id, agentId, keepLastMessages: 8 });

    const payload = {
      agent_id: agentId,
      session_id: session.session_id,
      dropped_messages: compacted.droppedMessages,
      kept_messages: compacted.keptMessages,
    };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "stop") {
    if (!deps.db) {
      return { output: "Stop is not available on this gateway instance.", data: null };
    }

    const agentId = resolveAgentId(deps.commandContext);
    const resolved =
      (await resolveKeyLane(deps.db, deps.commandContext)) ??
      (await resolveFallbackKeyLane(deps.db, deps.commandContext, agentId));
    if (!resolved) {
      return { output: "Usage: /stop (requires key or channel/thread context)", data: null };
    }
    const { key, lane } = resolved;

    const stopped = await cancelRunsAndClearQueuedInbox({
      db: deps.db,
      policyService: deps.policyService,
      key,
      lane,
      runReason: "stopped by /stop",
      inboxReason: "cancelled by /stop",
    });

    const payload = {
      key,
      lane,
      cancelled_runs: stopped.cancelledRuns,
      cleared_inbox: stopped.clearedInbox,
    };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "reset") {
    if (!deps.db) {
      return { output: "Sessions are not available on this gateway instance.", data: null };
    }

    const ctx = deps.commandContext;
    const agentId = resolveAgentId(ctx);
    const resolved = await resolveChannelThread(deps.db, ctx);
    if (!resolved) {
      return { output: "Usage: /reset (requires key or channel/thread context)", data: null };
    }
    const { channel, threadId } = resolved;

    const sessionDal = new SessionDal(deps.db);
    const session = await sessionDal.getOrCreate(channel, threadId, agentId);

    // Best-effort: stop active execution + clear queued followups (if we can resolve key/lane).
    const keyLane =
      (await resolveKeyLane(deps.db, ctx)) ??
      (await resolveFallbackKeyLane(deps.db, ctx, agentId)) ?? {
        key: buildDefaultCommandKey({ agentId, channel, threadId }),
        lane: "main",
      };
    if (keyLane?.key) {
      await cancelRunsAndClearQueuedInbox({
        db: deps.db,
        policyService: deps.policyService,
        key: keyLane.key,
        lane: keyLane.lane,
        runReason: "reset by /reset",
        inboxReason: "cancelled by /reset",
      });
    }

    await deps.db.transaction(async (tx) => {
      const sessionDalTx = new SessionDal(tx);
      const didReset = await sessionDalTx.reset(session.session_id, agentId);
      if (!didReset) {
        throw new Error(`Session ${session.session_id} not found`);
      }

      await tx.run(
        `DELETE FROM session_model_overrides
         WHERE agent_id = ? AND session_id = ?`,
        [agentId, session.session_id],
      );
      await tx.run(
        `DELETE FROM session_provider_pins
         WHERE agent_id = ? AND session_id = ?`,
        [agentId, session.session_id],
      );

      const queueOverrideDal = new LaneQueueModeOverrideDal(tx);
      await queueOverrideDal.clear({ key: keyLane.key, lane: keyLane.lane });

      const sendOverrideDal = new SessionSendPolicyOverrideDal(tx);
      await sendOverrideDal.clear({ key: keyLane.key });
    });

    const payload = {
      agent_id: agentId,
      session_id: session.session_id,
    };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "status") {
    const policy = deps.policyService ? await deps.policyService.getStatus() : null;
    const details = await buildStatusDetails({
      db: deps.db,
      policyService: deps.policyService,
      policyStatus: policy
        ? {
            enabled: policy.enabled,
            observe_only: policy.observe_only,
            effective_sha256: policy.effective_sha256,
          }
        : undefined,
      agents: deps.agents,
      modelsDev: deps.modelsDev,
    });
    const payload = {
      status: "ok",
      runtime: deps.runtime ?? null,
      ws: deps.connectionManager?.getStats() ?? null,
      policy,
      model_auth: details.model_auth,
      catalog_freshness: details.catalog_freshness,
      session_lanes: details.session_lanes,
      queue_depth: details.queue_depth,
      sandbox: details.sandbox,
    };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "presence") {
    if (!deps.presenceDal) {
      return { output: "Presence is not available on this gateway instance.", data: null };
    }
    const nowMs = Date.now();
    const rows = await deps.presenceDal.listNonExpired(nowMs, 200);
    const payload = { entries: rows };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "approvals") {
    if (!deps.approvalDal) {
      return { output: "Approvals are not available on this gateway instance.", data: null };
    }
    const status = toks[1]?.toLowerCase();
    const allowed = new Set(["pending", "approved", "denied", "expired", "cancelled"]);
    const filter = status && allowed.has(status) ? (status as "pending" | "approved" | "denied" | "expired" | "cancelled") : "pending";
    const rows = await deps.approvalDal.getByStatus(filter);
    const payload = { approvals: rows };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "pairings") {
    if (!deps.nodePairingDal) {
      return { output: "Node pairing is not available on this gateway instance.", data: null };
    }
    const status = toks[1]?.toLowerCase();
    const allowed = new Set(["pending", "approved", "denied", "revoked"]);
    const filter = status && allowed.has(status) ? (status as "pending" | "approved" | "denied" | "revoked") : undefined;
    const rows = await deps.nodePairingDal.list({ status: filter, limit: 100 });
    const payload = { pairings: rows };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "policy") {
    const sub = toks[1]?.toLowerCase();
    if (sub === "bundle") {
      if (!deps.policyService) {
        return { output: "PolicyBundle is not available on this gateway instance.", data: null };
      }
      const effective = await deps.policyService.loadEffectiveBundle();
      const payload = { effective: { sha256: effective.sha256, sources: effective.sources, bundle: effective.bundle } };
      return { output: jsonBlock(payload), data: payload };
    }

    if (sub === "overrides") {
      const action = toks[2]?.toLowerCase() ?? "list";
      if (!deps.policyOverrideDal) {
        return { output: "Policy overrides are not available on this gateway instance.", data: null };
      }

      if (action === "list") {
        const agentId = toks[3];
        const toolId = toks[4];
        const status = toks[5] as "active" | "revoked" | "expired" | undefined;
        const rows = await deps.policyOverrideDal.list({
          agentId: agentId && agentId.trim().length > 0 ? agentId : undefined,
          toolId: toolId && toolId.trim().length > 0 ? toolId : undefined,
          status,
          limit: 100,
        });
        const payload = { overrides: rows };
        return { output: jsonBlock(payload), data: payload };
      }

      if (action === "revoke") {
        const id = toks[3];
        if (!id) {
          return { output: "Usage: /policy overrides revoke <policy_override_id> [reason...]", data: null };
        }
        const reason = toks.slice(4).join(" ").trim() || undefined;
        const row = await deps.policyOverrideDal.revoke({
          policyOverrideId: id,
          revokedBy: { kind: "ws-command" },
          reason,
        });
        if (!row) {
          return { output: `Override ${id} not found or not active.`, data: null };
        }
        const payload = { override: row };
        return { output: jsonBlock(payload), data: payload };
      }

      if (action === "describe") {
        const id = toks[3];
        if (!id) {
          return { output: "Usage: /policy overrides describe <policy_override_id>", data: null };
        }
        const row = await deps.policyOverrideDal.getById(id);
        if (!row) {
          return { output: `Override ${id} not found.`, data: null };
        }
        const payload = { override: row };
        return { output: jsonBlock(payload), data: payload };
      }

      return { output: "Usage: /policy overrides list|describe|revoke", data: null };
    }

    return { output: "Usage: /policy bundle | /policy overrides ...", data: null };
  }

  if (cmd === "context") {
    const sub = toks[1]?.toLowerCase() ?? "last";

    if (sub === "last") {
      if (!deps.contextReportDal) {
        return { output: "Context reports are not available on this gateway instance.", data: null };
      }
      const rows = await deps.contextReportDal.list({ limit: 1 });
      const row = rows[0];
      if (!row) return { output: "No context reports found.", data: null };
      return { output: jsonBlock(row.report), data: row.report };
    }

    if (sub === "list") {
      if (!deps.contextReportDal) {
        return { output: "Context reports are not available on this gateway instance.", data: null };
      }
      const limitRaw = toks[2];
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;
      const rows = await deps.contextReportDal.list({ limit: Number.isFinite(limit) ? limit : 20 });
      const payload = {
        reports: rows.map((r) => ({
          context_report_id: r.context_report_id,
          created_at: r.created_at,
          session_id: r.session_id,
          channel: r.channel,
          thread_id: r.thread_id,
          run_id: r.run_id,
        })),
      };
      return { output: jsonBlock(payload), data: payload };
    }

    if (sub === "detail") {
      const id = toks[2];
      if (!id) {
        return { output: "Usage: /context detail <context_report_id>", data: null };
      }
      if (!deps.contextReportDal) {
        return { output: "Context reports are not available on this gateway instance.", data: null };
      }
      const row = await deps.contextReportDal.getById(id);
      if (!row) {
        return { output: `Context report ${id} not found.`, data: null };
      }
      return { output: jsonBlock(row.report), data: row.report };
    }

    return { output: "Usage: /context last | /context list [limit] | /context detail <id>", data: null };
  }

  if (cmd === "usage") {
    const sub = toks[1]?.toLowerCase();
    if (sub === "provider") {
      const poller = getProviderUsagePoller(deps);
      if (!poller) {
        return { output: "Provider usage polling is not available on this gateway instance.", data: null };
      }
      const provider = await poller.pollLatestPinned();
      return { output: jsonBlock(provider), data: provider };
    }

    if (!deps.db) {
      return { output: "Usage reporting is not available on this gateway instance.", data: null };
    }
    const runId = toks[1];
    const usage = await computeUsageTotals(deps.db, runId);
    const payload = {
      scope: { kind: runId ? "run" : "deployment", run_id: runId ?? null },
      local: usage,
    };
    return { output: formatUsageTotals(payload), data: payload };
  }

  if (cmd === "model") {
    if (!deps.db) {
      return { output: "Model overrides are not available on this gateway instance.", data: null };
    }

    const ctx = deps.commandContext;
    const agentId = resolveAgentId(ctx);
    const resolved = await resolveChannelThread(deps.db, ctx);
    if (!resolved) {
      return { output: "Usage: /model <provider/model> (requires key or channel/thread context)", data: null };
    }
    const { channel, threadId } = resolved;

    const sessionDal = new SessionDal(deps.db);
    const session = await sessionDal.getOrCreate(channel, threadId, agentId);
    const overrides = new SessionModelOverrideDal(deps.db);

    const modelArg = toks[1];
    if (!modelArg) {
      const existing = await overrides.get({ agentId, sessionId: session.session_id });
      const payload = {
        session_id: session.session_id,
        model_id: existing?.model_id ?? null,
      };
      return { output: jsonBlock(payload), data: payload };
    }

    const trimmed = modelArg.trim();
    const at = trimmed.indexOf("@");
    const modelIdRaw = at >= 0 ? trimmed.slice(0, at).trim() : trimmed;
    const profileIdRaw = at >= 0 ? trimmed.slice(at + 1).trim() : undefined;

    if (profileIdRaw !== undefined && profileIdRaw.length === 0) {
      return { output: "Usage: /model <provider/model>@<profile>", data: null };
    }

    const slash = modelIdRaw.indexOf("/");
    if (slash <= 0 || slash === modelIdRaw.length - 1) {
      return { output: `Invalid model '${modelIdRaw}' (expected provider/model).`, data: null };
    }

    const providerId = modelIdRaw.slice(0, slash);
    const modelId = modelIdRaw.slice(slash + 1);

    if (deps.modelsDev) {
      const loaded = await deps.modelsDev.ensureLoaded();
      const provider = loaded.catalog[providerId];
      const model = provider?.models?.[modelId];
      if (!provider || !model) {
        return { output: `Model '${modelIdRaw}' not found in models.dev catalog.`, data: null };
      }
    }

    if (profileIdRaw) {
      if (!isAuthProfilesEnabled()) {
        return { output: "Auth profiles are not enabled on this gateway instance.", data: null };
      }

      const authProfileDal = new AuthProfileDal(deps.db);
      const profile = await authProfileDal.getById(profileIdRaw);
      if (!profile) {
        return { output: `Auth profile ${profileIdRaw} not found.`, data: null };
      }
      if (profile.agent_id !== agentId) {
        return { output: `Auth profile ${profileIdRaw} is not scoped to agent '${agentId}'.`, data: null };
      }
      if (profile.provider !== providerId) {
        return { output: `Auth profile ${profileIdRaw} is for provider '${profile.provider}', not '${providerId}'.`, data: null };
      }
      if (profile.status !== "active") {
        return { output: `Auth profile ${profileIdRaw} is not active.`, data: null };
      }

      const res = await deps.db.transaction(async (tx) => {
        const modelOverrideDal = new SessionModelOverrideDal(tx);
        const row = await modelOverrideDal.upsert({
          agentId,
          sessionId: session.session_id,
          modelId: modelIdRaw,
        });
        const pins = new SessionProviderPinDal(tx);
        const pinned = await pins.upsert({
          agentId,
          sessionId: session.session_id,
          provider: providerId,
          profileId: profileIdRaw,
        });
        return { row, pinned };
      });

      const payload = {
        session_id: res.row.session_id,
        model_id: res.row.model_id,
        provider: res.pinned.provider,
        profile_id: res.pinned.profile_id,
      };
      return { output: jsonBlock(payload), data: payload };
    }

    const row = await deps.db.transaction(async (tx) => {
      const modelOverrideDal = new SessionModelOverrideDal(tx);
      const row = await modelOverrideDal.upsert({
        agentId,
        sessionId: session.session_id,
        modelId: modelIdRaw,
      });
      const pins = new SessionProviderPinDal(tx);
      await pins.clear({ agentId, sessionId: session.session_id, provider: providerId });
      return row;
    });

    const payload = {
      session_id: row.session_id,
      model_id: row.model_id,
    };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "queue") {
    if (!deps.db) {
      return { output: "Queue mode overrides are not available on this gateway instance.", data: null };
    }

    const resolved = await resolveKeyLane(deps.db, deps.commandContext);
    if (!resolved) {
      return { output: "Usage: /queue <collect|followup|steer|steer_backlog|interrupt> (requires key or channel/thread context)", data: null };
    }
    const { key, lane } = resolved;

    const dal = new LaneQueueModeOverrideDal(deps.db);
    const modeArg = toks[1]?.trim().toLowerCase();
    const allowed = new Set(["collect", "followup", "steer", "steer_backlog", "interrupt"]);

    if (!modeArg) {
      const existing = await dal.get({ key, lane });
      const payload = {
        key,
        lane,
        queue_mode: existing?.queue_mode ?? "collect",
      };
      return { output: jsonBlock(payload), data: payload };
    }

    if (!allowed.has(modeArg)) {
      return { output: "Usage: /queue <collect|followup|steer|steer_backlog|interrupt>", data: null };
    }

    const row = await dal.upsert({ key, lane, queueMode: modeArg });
    const payload = { key: row.key, lane: row.lane, queue_mode: row.queue_mode };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "send") {
    if (!deps.db) {
      return { output: "Send policy overrides are not available on this gateway instance.", data: null };
    }

    const resolved = await resolveKeyLane(deps.db, deps.commandContext);
    if (!resolved?.key) {
      return { output: "Usage: /send <on|off|inherit> (requires key or channel/thread context)", data: null };
    }
    const { key } = resolved;

    const dal = new SessionSendPolicyOverrideDal(deps.db);
    const arg = toks[1]?.trim().toLowerCase();

    if (!arg) {
      const existing = await dal.get({ key });
      const payload = { key, send_policy: existing?.send_policy ?? "inherit" };
      return { output: jsonBlock(payload), data: payload };
    }

    if (arg === "inherit") {
      try {
        await dal.clear({ key });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { output: `Failed to clear send policy override: ${message}`, data: null };
      }
      const payload = { key, send_policy: "inherit" };
      return { output: jsonBlock(payload), data: payload };
    }

    if (arg !== "on" && arg !== "off") {
      return { output: "Usage: /send <on|off|inherit>", data: null };
    }

    const row = await dal.upsert({ key, sendPolicy: arg });
    const payload = { key: row.key, send_policy: row.send_policy };
    return { output: jsonBlock(payload), data: payload };
  }

  if (deps.plugins) {
    const res = await deps.plugins.tryExecuteCommand(raw);
    if (res) return res;
  }

  return { output: `Unknown command '${cmd}'. Try /help.`, data: null };
}
