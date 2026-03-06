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
import type { ModelCatalogService } from "../models/model-catalog-service.js";
import type { AgentRegistry } from "../agent/registry.js";
import { buildStatusDetails } from "../observability/status-details.js";
import { AuthProfileDal } from "../models/auth-profile-dal.js";
import { SessionProviderPinDal } from "../models/session-pin-dal.js";
import { ProviderUsagePoller } from "../observability/provider-usage.js";
import { SessionDal } from "../agent/session-dal.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../identity/scope.js";
import { ChannelThreadDal } from "../channels/thread-dal.js";
import { ConfiguredModelPresetDal } from "../models/configured-model-preset-dal.js";
import { SessionModelOverrideDal } from "../models/session-model-override-dal.js";
import { isAuthProfilesEnabled } from "../models/auth-profiles-enabled.js";
import { LaneQueueModeOverrideDal } from "../lanes/queue-mode-override-dal.js";
import { IntakeModeOverrideDal } from "../agent/intake-mode-override-dal.js";
import { SessionSendPolicyOverrideDal } from "../channels/send-policy-override-dal.js";
import { DEFAULT_CHANNEL_ACCOUNT_ID, parseChannelSourceKey } from "../channels/interface.js";
import { resolveWorkspaceKey } from "../workspace/id.js";
import { buildAgentTurnKey, encodeTurnKeyPart } from "../agent/turn-key.js";
import { randomUUID } from "node:crypto";
import { ExecutionEngine } from "../execution/engine.js";

export type CommandExecuteResult = {
  output: string;
  data?: unknown;
};

export interface CommandDeps {
  tenantId?: string;
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
  modelCatalog?: ModelCatalogService;
  agents?: AgentRegistry;
  fetchImpl?: typeof fetch;
}

function getProviderUsagePoller(deps: CommandDeps): ProviderUsagePoller | undefined {
  if (!deps.db || !deps.agents) return undefined;
  const tenantId = deps.tenantId?.trim() || DEFAULT_TENANT_ID;
  const agentId = resolveAgentId(deps.commandContext);
  return new ProviderUsagePoller({
    authProfileDal: new AuthProfileDal(deps.db),
    pinDal: new SessionProviderPinDal(deps.db),
    secretProviderGetter: async () => deps.agents!.getSecretProvider(tenantId, agentId),
    fetchImpl: deps.fetchImpl,
  });
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

function isLegacyConfiguredPresetKey(presetKey: string): boolean {
  return presetKey.trim().toLowerCase().startsWith("legacy-");
}

type UsageTotals = {
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  usd_micros: number;
};

const DEFAULT_REPAIR_MAX_TURNS = 20;

async function resolveKeyLane(
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
      if (parsed.accountId === "default") {
        sources.push({ exact: parsed.connector });
      }
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

function resolveAgentId(ctx: CommandDeps["commandContext"] | undefined): string {
  const explicit = ctx?.agentId?.trim();
  if (explicit) return explicit;

  const key = ctx?.key?.trim();
  if (key) {
    try {
      const parsed = parseTyrumKey(key as never);
      if (parsed.kind === "agent") return parsed.agent_key;
    } catch {
      // Intentional: ignore invalid keys; fall back to default agent.
    }
  }

  return "default";
}

function buildDefaultCommandKey(input: {
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

function resolveContainerKindFromSessionKey(key: string | undefined): "dm" | "group" | "channel" {
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

async function resolveChannelThread(
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
  return {
    duration_ms: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    usd_micros: 0,
  };
}

async function computeUsageTotals(
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
      // Intentional: skip invalid cost JSON rows.
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
    "- /repair [max_turns]",
    "- /status",
    "- /presence",
    "- /approvals [pending|approved|denied|expired]",
    "- /pairings [pending|approved|denied|revoked]",
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

export async function executeCommand(
  raw: string,
  deps: CommandDeps,
): Promise<CommandExecuteResult> {
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
    let accountKey: string | undefined;
    try {
      const parsed = parseChannelSourceKey(channelRaw);
      channel = parsed.connector;
      accountKey = parsed.accountId === DEFAULT_CHANNEL_ACCOUNT_ID ? undefined : parsed.accountId;
    } catch {
      // Intentional: accept unscoped channel IDs by stripping any connector suffix.
      const idx = channel.indexOf(":");
      if (idx > 0) channel = channel.slice(0, idx);
    }
    if (!channel) {
      return { output: "Usage: /new (requires channel context)", data: null };
    }

    const threadId = `${channel}-${randomUUID()}`;
    const sessionDal = new SessionDal(
      deps.db,
      new IdentityScopeDal(deps.db),
      new ChannelThreadDal(deps.db),
    );
    const tenantId = deps.tenantId?.trim() || DEFAULT_TENANT_ID;
    const session = await sessionDal.getOrCreate({
      tenantId,
      scopeKeys: { agentKey: agentId, workspaceKey: resolveWorkspaceKey() },
      connectorKey: channel,
      accountKey,
      providerThreadId: threadId,
      containerKind: "channel",
    });

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
    const { channel, accountKey, threadId } = resolved;

    const sessionDal = new SessionDal(
      deps.db,
      new IdentityScopeDal(deps.db),
      new ChannelThreadDal(deps.db),
    );
    const session = await sessionDal.getOrCreate({
      scopeKeys: { agentKey: agentId, workspaceKey: resolveWorkspaceKey() },
      connectorKey: channel,
      accountKey,
      providerThreadId: threadId,
      containerKind: "channel",
    });
    const compacted = await sessionDal.compact({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      keepLastMessages: 8,
    });

    const payload = {
      agent_id: agentId,
      session_id: session.session_id,
      dropped_messages: compacted.droppedMessages,
      kept_messages: compacted.keptMessages,
    };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "repair") {
    if (!deps.db) {
      return { output: "Sessions are not available on this gateway instance.", data: null };
    }

    const ctx = deps.commandContext;
    const agentId = resolveAgentId(ctx);
    const resolved = await resolveChannelThread(deps.db, ctx);
    if (!resolved) {
      return {
        output: "Usage: /repair [max_turns] (requires key or channel/thread context)",
        data: null,
      };
    }

    const maxTurnsRaw = toks[1]?.trim();
    let maxTurns = DEFAULT_REPAIR_MAX_TURNS;
    if (maxTurnsRaw) {
      if (!/^[0-9]+$/.test(maxTurnsRaw)) {
        return {
          output: "Usage: /repair [max_turns] (max_turns must be a positive integer)",
          data: null,
        };
      }
      maxTurns = Math.min(500, Math.max(1, Number(maxTurnsRaw)));
    }

    const { channel, accountKey, threadId } = resolved;
    const keyLane =
      (await resolveKeyLane(deps.db, ctx)) ?? (await resolveFallbackKeyLane(deps.db, ctx, agentId));
    const sessionDal = new SessionDal(
      deps.db,
      new IdentityScopeDal(deps.db),
      new ChannelThreadDal(deps.db),
    );
    const session = await sessionDal.getOrCreate({
      scopeKeys: { agentKey: agentId, workspaceKey: resolveWorkspaceKey() },
      connectorKey: channel,
      accountKey,
      providerThreadId: threadId,
      containerKind: resolveContainerKindFromSessionKey(keyLane?.key),
    });
    const repaired = await sessionDal.repairFromChannelLogs({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
      maxTurns,
    });
    if (!repaired) {
      return {
        output: "No completed retained channel logs were found for this session.",
        data: null,
      };
    }

    const payload = {
      agent_id: agentId,
      session_id: session.session_id,
      ...repaired,
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
    const { channel, accountKey, threadId } = resolved;

    // Best-effort: stop active execution + clear queued followups (if we can resolve key/lane).
    const keyLane = (await resolveKeyLane(deps.db, ctx)) ??
      (await resolveFallbackKeyLane(deps.db, ctx, agentId)) ?? {
        key: buildDefaultCommandKey({ agentId, channel, threadId }),
        lane: "main",
      };

    const sessionDal = new SessionDal(
      deps.db,
      new IdentityScopeDal(deps.db),
      new ChannelThreadDal(deps.db),
    );
    const session = await sessionDal.getOrCreate({
      scopeKeys: { agentKey: agentId, workspaceKey: resolveWorkspaceKey() },
      connectorKey: channel,
      accountKey,
      providerThreadId: threadId,
      containerKind: resolveContainerKindFromSessionKey(keyLane.key),
    });

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
      const sessionDalTx = new SessionDal(tx, new IdentityScopeDal(tx), new ChannelThreadDal(tx));
      const didReset = await sessionDalTx.reset({
        tenantId: session.tenant_id,
        sessionId: session.session_id,
      });
      if (!didReset) {
        throw new Error(`Session ${session.session_id} not found`);
      }

      await tx.run(
        `DELETE FROM session_model_overrides
	         WHERE tenant_id = ? AND session_id = ?`,
        [session.tenant_id, session.session_id],
      );
      await tx.run(
        `DELETE FROM session_provider_pins
	         WHERE tenant_id = ? AND session_id = ?`,
        [session.tenant_id, session.session_id],
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
    const tenantId = deps.tenantId?.trim() || DEFAULT_TENANT_ID;
    const policy = deps.policyService ? await deps.policyService.getStatus() : null;
    const details = await buildStatusDetails({
      tenantId,
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
    const filter =
      status && allowed.has(status)
        ? (status as "pending" | "approved" | "denied" | "expired" | "cancelled")
        : "pending";
    const tenantId = deps.tenantId?.trim() || DEFAULT_TENANT_ID;
    const rows = await deps.approvalDal.getByStatus({
      tenantId,
      status: filter,
    });
    const payload = { approvals: rows };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "pairings") {
    if (!deps.nodePairingDal) {
      return { output: "Node pairing is not available on this gateway instance.", data: null };
    }
    const status = toks[1]?.toLowerCase();
    const allowed = new Set(["pending", "approved", "denied", "revoked"]);
    const filter =
      status && allowed.has(status)
        ? (status as "pending" | "approved" | "denied" | "revoked")
        : undefined;
    const rows = await deps.nodePairingDal.list({ status: filter, limit: 100 });
    const payload = { pairings: rows };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "policy") {
    const tenantId = deps.tenantId?.trim() || DEFAULT_TENANT_ID;
    const sub = toks[1]?.toLowerCase();
    if (sub === "bundle") {
      if (!deps.policyService) {
        return { output: "PolicyBundle is not available on this gateway instance.", data: null };
      }
      const effective = await deps.policyService.loadEffectiveBundle();
      const payload = {
        effective: {
          sha256: effective.sha256,
          sources: effective.sources,
          bundle: effective.bundle,
        },
      };
      return { output: jsonBlock(payload), data: payload };
    }

    if (sub === "overrides") {
      const action = toks[2]?.toLowerCase() ?? "list";
      if (!deps.policyOverrideDal) {
        return {
          output: "Policy overrides are not available on this gateway instance.",
          data: null,
        };
      }

      if (action === "list") {
        const agentId = toks[3];
        const toolId = toks[4];
        const status = toks[5] as "active" | "revoked" | "expired" | undefined;
        const rows = await deps.policyOverrideDal.list({
          tenantId,
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
          return {
            output: "Usage: /policy overrides revoke <policy_override_id> [reason...]",
            data: null,
          };
        }
        const reason = toks.slice(4).join(" ").trim() || undefined;
        const row = await deps.policyOverrideDal.revoke({
          tenantId,
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
        const row = await deps.policyOverrideDal.getById({ tenantId, policyOverrideId: id });
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
        return {
          output: "Context reports are not available on this gateway instance.",
          data: null,
        };
      }
      const rows = await deps.contextReportDal.list({ limit: 1 });
      const row = rows[0];
      if (!row) return { output: "No context reports found.", data: null };
      return { output: jsonBlock(row.report), data: row.report };
    }

    if (sub === "list") {
      if (!deps.contextReportDal) {
        return {
          output: "Context reports are not available on this gateway instance.",
          data: null,
        };
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
        return {
          output: "Context reports are not available on this gateway instance.",
          data: null,
        };
      }
      const row = await deps.contextReportDal.getById({ contextReportId: id });
      if (!row) {
        return { output: `Context report ${id} not found.`, data: null };
      }
      return { output: jsonBlock(row.report), data: row.report };
    }

    return {
      output: "Usage: /context last | /context list [limit] | /context detail <id>",
      data: null,
    };
  }

  if (cmd === "usage") {
    const sub = toks[1]?.toLowerCase();
    if (sub === "provider") {
      const poller = getProviderUsagePoller(deps);
      if (!poller) {
        return {
          output: "Provider usage polling is not available on this gateway instance.",
          data: null,
        };
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
      return {
        output:
          "Usage: /model <preset_key|provider/model[@profile]> (requires key or channel/thread context)",
        data: null,
      };
    }
    const { channel, accountKey, threadId } = resolved;

    const sessionDal = new SessionDal(
      deps.db,
      new IdentityScopeDal(deps.db),
      new ChannelThreadDal(deps.db),
    );
    const session = await sessionDal.getOrCreate({
      scopeKeys: { agentKey: agentId, workspaceKey: resolveWorkspaceKey() },
      connectorKey: channel,
      accountKey,
      providerThreadId: threadId,
      containerKind: "channel",
    });
    const overrides = new SessionModelOverrideDal(deps.db);
    const presetDal = new ConfiguredModelPresetDal(deps.db);

    const modelArg = toks[1];
    if (!modelArg) {
      const existing = await overrides.get({
        tenantId: session.tenant_id,
        sessionId: session.session_id,
      });
      const payload = {
        session_id: session.session_id,
        model_id: existing?.model_id ?? null,
        preset_key: existing?.preset_key ?? null,
      };
      return { output: jsonBlock(payload), data: payload };
    }

    const trimmed = modelArg.trim();
    const at = trimmed.indexOf("@");
    const modelSelectorRaw = at >= 0 ? trimmed.slice(0, at).trim() : trimmed;
    const profileIdRaw = at >= 0 ? trimmed.slice(at + 1).trim() : undefined;

    if (profileIdRaw !== undefined && profileIdRaw.length === 0) {
      return { output: "Usage: /model <provider/model>@<profile>", data: null };
    }

    const directPreset = profileIdRaw
      ? undefined
      : await presetDal.getByKey({
          tenantId: session.tenant_id,
          presetKey: modelSelectorRaw,
        });
    let presetKey: string | null = directPreset?.preset_key ?? null;
    let modelIdRaw =
      directPreset != null
        ? `${directPreset.provider_key}/${directPreset.model_id}`
        : modelSelectorRaw;

    const slash = modelIdRaw.indexOf("/");
    if (slash <= 0 || slash === modelIdRaw.length - 1) {
      if (profileIdRaw) {
        return {
          output: `Invalid model '${modelSelectorRaw}' (expected provider/model).`,
          data: null,
        };
      }
      return directPreset
        ? {
            output: `Configured model preset '${modelSelectorRaw}' is misconfigured.`,
            data: null,
          }
        : { output: `Configured model preset '${modelSelectorRaw}' not found.`, data: null };
    }

    const providerId = modelIdRaw.slice(0, slash);
    const modelId = modelIdRaw.slice(slash + 1);

    if (!directPreset && !profileIdRaw) {
      const matchingPresets = (await presetDal.list({ tenantId: session.tenant_id })).filter(
        (preset) =>
          !isLegacyConfiguredPresetKey(preset.preset_key) &&
          preset.provider_key === providerId &&
          preset.model_id === modelId,
      );

      if (matchingPresets.length > 1) {
        const keys = matchingPresets
          .map((preset) => preset.preset_key)
          .sort((a, b) => a.localeCompare(b))
          .join(", ");
        return {
          output: `Model '${modelIdRaw}' matches multiple configured presets: ${keys}. Use /model <preset_key>.`,
          data: null,
        };
      }
      if (matchingPresets.length === 1) {
        const matchedPreset = matchingPresets[0]!;
        presetKey = matchedPreset.preset_key;
        modelIdRaw = `${matchedPreset.provider_key}/${matchedPreset.model_id}`;
      }
    }

    if (deps.modelCatalog || deps.modelsDev) {
      const loaded = deps.modelCatalog
        ? await deps.modelCatalog.getEffectiveCatalog({ tenantId: session.tenant_id })
        : await deps.modelsDev!.ensureLoaded();

      const provider = loaded.catalog[providerId];
      const providerEnabled = provider
        ? ((provider as { enabled?: boolean }).enabled ?? true)
        : false;
      const model = provider?.models?.[modelId];
      const modelEnabled = model ? ((model as { enabled?: boolean }).enabled ?? true) : false;

      if (!provider || !providerEnabled || !model || !modelEnabled) {
        return { output: `Model '${modelIdRaw}' not found in models.dev catalog.`, data: null };
      }
    }

    if (profileIdRaw) {
      if (!isAuthProfilesEnabled()) {
        return { output: "Auth profiles are not enabled on this gateway instance.", data: null };
      }

      const authProfileDal = new AuthProfileDal(deps.db);
      const profile = await authProfileDal.getByKey({
        tenantId: session.tenant_id,
        authProfileKey: profileIdRaw,
      });
      if (!profile) {
        return { output: `Auth profile ${profileIdRaw} not found.`, data: null };
      }
      if (profile.provider_key !== providerId) {
        return {
          output: `Auth profile ${profileIdRaw} is for provider '${profile.provider_key}', not '${providerId}'.`,
          data: null,
        };
      }
      if (profile.status !== "active") {
        return { output: `Auth profile ${profileIdRaw} is not active.`, data: null };
      }

      const res = await deps.db.transaction(async (tx) => {
        const modelOverrideDal = new SessionModelOverrideDal(tx);
        const row = await modelOverrideDal.upsert({
          tenantId: session.tenant_id,
          sessionId: session.session_id,
          modelId: modelIdRaw,
          presetKey: null,
        });
        const pins = new SessionProviderPinDal(tx);
        const pinned = await pins.upsert({
          tenantId: session.tenant_id,
          sessionId: session.session_id,
          providerKey: providerId,
          authProfileId: profile.auth_profile_id,
        });
        return { row, pinned };
      });

      const payload = {
        session_id: res.row.session_id,
        model_id: res.row.model_id,
        provider_key: res.pinned.provider_key,
        auth_profile_id: res.pinned.auth_profile_id,
        auth_profile_key: res.pinned.auth_profile_key,
      };
      return { output: jsonBlock(payload), data: payload };
    }

    const row = await deps.db.transaction(async (tx) => {
      const modelOverrideDal = new SessionModelOverrideDal(tx);
      const overrideRow = await modelOverrideDal.upsert({
        tenantId: session.tenant_id,
        sessionId: session.session_id,
        modelId: modelIdRaw,
        presetKey,
      });
      const pins = new SessionProviderPinDal(tx);
      await pins.clear({
        tenantId: session.tenant_id,
        sessionId: session.session_id,
        providerKey: providerId,
      });
      return overrideRow;
    });

    const payload = {
      session_id: row.session_id,
      model_id: row.model_id,
      preset_key: row.preset_key,
    };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "intake") {
    if (!deps.db) {
      return {
        output: "Intake mode overrides are not available on this gateway instance.",
        data: null,
      };
    }

    const agentId = resolveAgentId(deps.commandContext);
    const resolved =
      (await resolveKeyLane(deps.db, deps.commandContext)) ??
      (await resolveFallbackKeyLane(deps.db, deps.commandContext, agentId));
    if (!resolved) {
      return {
        output:
          "Usage: /intake <auto|inline|delegate_execute|delegate_plan> (requires key or channel/thread context)",
        data: null,
      };
    }
    const { key } = resolved;
    const lane = "main";

    const dal = new IntakeModeOverrideDal(deps.db);
    const modeArg = toks[1]?.trim().toLowerCase();
    const allowed = new Set(["auto", "inline", "delegate_execute", "delegate_plan"]);

    if (!modeArg) {
      const existing = await dal.get({ key, lane });
      const payload = {
        key,
        lane,
        intake_mode: existing?.intake_mode ?? "auto",
      };
      return { output: jsonBlock(payload), data: payload };
    }

    if (!allowed.has(modeArg)) {
      return {
        output: "Usage: /intake <auto|inline|delegate_execute|delegate_plan>",
        data: null,
      };
    }

    if (modeArg === "auto") {
      await dal.clear({ key, lane });
      const payload = { key, lane, intake_mode: "auto" };
      return { output: jsonBlock(payload), data: payload };
    }

    const row = await dal.upsert({ key, lane, intakeMode: modeArg });
    const payload = { key: row.key, lane: row.lane, intake_mode: row.intake_mode };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "queue") {
    if (!deps.db) {
      return {
        output: "Queue mode overrides are not available on this gateway instance.",
        data: null,
      };
    }

    const resolved = await resolveKeyLane(deps.db, deps.commandContext);
    if (!resolved) {
      return {
        output:
          "Usage: /queue <collect|followup|steer|steer_backlog|interrupt> (requires key or channel/thread context)",
        data: null,
      };
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
      return {
        output: "Usage: /queue <collect|followup|steer|steer_backlog|interrupt>",
        data: null,
      };
    }

    const row = await dal.upsert({ key, lane, queueMode: modeArg });
    const payload = { key: row.key, lane: row.lane, queue_mode: row.queue_mode };
    return { output: jsonBlock(payload), data: payload };
  }

  if (cmd === "send") {
    if (!deps.db) {
      return {
        output: "Send policy overrides are not available on this gateway instance.",
        data: null,
      };
    }

    const resolved = await resolveKeyLane(deps.db, deps.commandContext);
    if (!resolved?.key) {
      return {
        output: "Usage: /send <on|off|inherit> (requires key or channel/thread context)",
        data: null,
      };
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
