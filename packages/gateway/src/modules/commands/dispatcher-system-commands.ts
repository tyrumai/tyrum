import { DEFAULT_CHANNEL_ACCOUNT_ID, parseChannelSourceKey } from "../channels/interface.js";
import { LaneQueueModeOverrideDal } from "../lanes/queue-mode-override-dal.js";
import { SessionSendPolicyOverrideDal } from "../channels/send-policy-override-dal.js";
import { resolveWorkspaceKey } from "../workspace/id.js";
import { randomUUID } from "node:crypto";
import type { CommandDeps, CommandExecuteResult } from "./dispatcher.js";
import {
  buildStatusPayload,
  buildDefaultCommandKey,
  cancelRunsAndClearQueuedInbox,
  createSessionDal,
  helpText,
  jsonBlock,
  resolveAgentId,
  resolveChannelThread,
  resolveContainerKindFromSessionKey,
  resolveFallbackKeyLane,
  resolveKeyLane,
  resolveTenantId,
} from "./dispatcher-support.js";

type CommandInput = {
  cmd: string;
  deps: CommandDeps;
  toks: string[];
};

export async function tryExecuteSystemCommand(
  input: CommandInput,
): Promise<CommandExecuteResult | undefined> {
  if (input.cmd === "help" || input.cmd === "?") {
    return { output: helpText(), data: { commands: helpText() } };
  }
  if (input.cmd === "new") return executeNewCommand(input.deps);
  if (input.cmd === "compact") return executeCompactCommand(input.deps);
  if (input.cmd === "repair") return executeRepairCommand(input.deps);
  if (input.cmd === "stop") return executeStopCommand(input.deps);
  if (input.cmd === "reset") return executeResetCommand(input.deps);
  if (input.cmd === "status") return executeStatusCommand(input.deps);
  if (input.cmd === "presence") return executePresenceCommand(input.deps);
  if (input.cmd === "approvals") return executeApprovalsCommand(input.deps, input.toks);
  if (input.cmd === "pairings") return executePairingsCommand(input.deps, input.toks);
  return undefined;
}

async function executeNewCommand(deps: CommandDeps): Promise<CommandExecuteResult> {
  if (!deps.db)
    return { output: "Sessions are not available on this gateway instance.", data: null };

  const ctx = deps.commandContext;
  const agentId = resolveAgentId(ctx);
  const channelRaw = ctx?.channel?.trim();
  if (!channelRaw) return { output: "Usage: /new (requires channel context)", data: null };

  let channel = channelRaw;
  let accountKey: string | undefined;
  try {
    const parsed = parseChannelSourceKey(channelRaw);
    channel = parsed.connector;
    accountKey = parsed.accountId === DEFAULT_CHANNEL_ACCOUNT_ID ? undefined : parsed.accountId;
  } catch {
    // Intentional: fall back to legacy channel parsing for malformed composite keys.
    const idx = channel.indexOf(":");
    if (idx > 0) channel = channel.slice(0, idx);
  }
  if (!channel) return { output: "Usage: /new (requires channel context)", data: null };

  const threadId = `${channel}-${randomUUID()}`;
  const session = await createSessionDal(deps.db).getOrCreate({
    tenantId: resolveTenantId(deps),
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

async function executeCompactCommand(deps: CommandDeps): Promise<CommandExecuteResult> {
  if (!deps.db)
    return { output: "Sessions are not available on this gateway instance.", data: null };
  if (!deps.agents) {
    return { output: "Compaction is not available on this gateway instance.", data: null };
  }

  const ctx = deps.commandContext;
  const agentId = resolveAgentId(ctx);
  const resolved = await resolveChannelThread(deps.db, ctx);
  if (!resolved)
    return { output: "Usage: /compact (requires key or channel/thread context)", data: null };

  const session = await createSessionDal(deps.db).getOrCreate({
    scopeKeys: { agentKey: agentId, workspaceKey: resolveWorkspaceKey() },
    connectorKey: resolved.channel,
    accountKey: resolved.accountKey,
    providerThreadId: resolved.threadId,
    containerKind: "channel",
  });
  const runtime = await deps.agents.getRuntime({
    tenantId: resolveTenantId(deps),
    agentKey: agentId,
  });
  const compacted = await runtime.compactSession({
    sessionId: session.session_id,
  });
  const payload = {
    agent_id: agentId,
    session_id: session.session_id,
    dropped_messages: compacted.droppedMessages,
    kept_messages: compacted.keptMessages,
  };
  return { output: jsonBlock(payload), data: payload };
}

async function executeRepairCommand(deps: CommandDeps): Promise<CommandExecuteResult> {
  if (!deps.db)
    return { output: "Sessions are not available on this gateway instance.", data: null };

  const ctx = deps.commandContext;
  const agentId = resolveAgentId(ctx);
  const resolved = await resolveChannelThread(deps.db, ctx);
  if (!resolved) {
    return {
      output: "Usage: /repair (requires key or channel/thread context)",
      data: null,
    };
  }

  const keyLane =
    (await resolveKeyLane(deps.db, ctx)) ?? (await resolveFallbackKeyLane(deps.db, ctx, agentId));
  const session = await createSessionDal(deps.db).getOrCreate({
    scopeKeys: { agentKey: agentId, workspaceKey: resolveWorkspaceKey() },
    connectorKey: resolved.channel,
    accountKey: resolved.accountKey,
    providerThreadId: resolved.threadId,
    containerKind: resolveContainerKindFromSessionKey(keyLane?.key),
  });
  const repaired = await createSessionDal(deps.db).repairFromChannelLogs({
    tenantId: session.tenant_id,
    sessionId: session.session_id,
  });
  if (!repaired) {
    return {
      output: "No completed retained channel logs were found for this session.",
      data: null,
    };
  }

  const payload = { agent_id: agentId, session_id: session.session_id, ...repaired };
  return { output: jsonBlock(payload), data: payload };
}

async function executeStopCommand(deps: CommandDeps): Promise<CommandExecuteResult> {
  if (!deps.db) return { output: "Stop is not available on this gateway instance.", data: null };

  const agentId = resolveAgentId(deps.commandContext);
  const resolved =
    (await resolveKeyLane(deps.db, deps.commandContext)) ??
    (await resolveFallbackKeyLane(deps.db, deps.commandContext, agentId));
  if (!resolved)
    return { output: "Usage: /stop (requires key or channel/thread context)", data: null };

  const stopped = await cancelRunsAndClearQueuedInbox({
    db: deps.db,
    policyService: deps.policyService,
    key: resolved.key,
    lane: resolved.lane,
    runReason: "stopped by /stop",
    inboxReason: "cancelled by /stop",
  });
  const payload = {
    key: resolved.key,
    lane: resolved.lane,
    cancelled_runs: stopped.cancelledRuns,
    cleared_inbox: stopped.clearedInbox,
  };
  return { output: jsonBlock(payload), data: payload };
}

async function executeResetCommand(deps: CommandDeps): Promise<CommandExecuteResult> {
  if (!deps.db)
    return { output: "Sessions are not available on this gateway instance.", data: null };

  const ctx = deps.commandContext;
  const agentId = resolveAgentId(ctx);
  const resolved = await resolveChannelThread(deps.db, ctx);
  if (!resolved)
    return { output: "Usage: /reset (requires key or channel/thread context)", data: null };

  const keyLane = (await resolveKeyLane(deps.db, ctx)) ??
    (await resolveFallbackKeyLane(deps.db, ctx, agentId)) ?? {
      key: buildDefaultCommandKey({
        agentId,
        channel: resolved.channel,
        threadId: resolved.threadId,
      }),
      lane: "main",
    };
  const sessionDal = createSessionDal(deps.db);
  const session = await sessionDal.getOrCreate({
    scopeKeys: { agentKey: agentId, workspaceKey: resolveWorkspaceKey() },
    connectorKey: resolved.channel,
    accountKey: resolved.accountKey,
    providerThreadId: resolved.threadId,
    containerKind: resolveContainerKindFromSessionKey(keyLane.key),
  });

  if (keyLane.key) {
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
    const sessionDalTx = createSessionDal(tx);
    const didReset = await sessionDalTx.reset({
      tenantId: session.tenant_id,
      sessionId: session.session_id,
    });
    if (!didReset) throw new Error(`Session ${session.session_id} not found`);

    await tx.run(`DELETE FROM session_model_overrides WHERE tenant_id = ? AND session_id = ?`, [
      session.tenant_id,
      session.session_id,
    ]);
    await tx.run(`DELETE FROM session_provider_pins WHERE tenant_id = ? AND session_id = ?`, [
      session.tenant_id,
      session.session_id,
    ]);
    await new LaneQueueModeOverrideDal(tx).clear({ key: keyLane.key, lane: keyLane.lane });
    await new SessionSendPolicyOverrideDal(tx).clear({ key: keyLane.key });
  });

  const payload = { agent_id: agentId, session_id: session.session_id };
  return { output: jsonBlock(payload), data: payload };
}

async function executeStatusCommand(deps: CommandDeps): Promise<CommandExecuteResult> {
  const payload = await buildStatusPayload(deps);
  return { output: jsonBlock(payload), data: payload };
}

async function executePresenceCommand(deps: CommandDeps): Promise<CommandExecuteResult> {
  if (!deps.presenceDal) {
    return { output: "Presence is not available on this gateway instance.", data: null };
  }
  const payload = { entries: await deps.presenceDal.listNonExpired(Date.now(), 200) };
  return { output: jsonBlock(payload), data: payload };
}

async function executeApprovalsCommand(
  deps: CommandDeps,
  toks: string[],
): Promise<CommandExecuteResult> {
  if (!deps.approvalDal) {
    return { output: "Approvals are not available on this gateway instance.", data: null };
  }
  const status = toks[1]?.toLowerCase();
  const allowed = new Set(["pending", "approved", "denied", "expired", "cancelled"]);
  const filter = status && allowed.has(status) ? status : "pending";
  const payload = {
    approvals: await deps.approvalDal.getByStatus({
      tenantId: resolveTenantId(deps),
      status: filter as never,
    }),
  };
  return { output: jsonBlock(payload), data: payload };
}

async function executePairingsCommand(
  deps: CommandDeps,
  toks: string[],
): Promise<CommandExecuteResult> {
  if (!deps.nodePairingDal) {
    return { output: "Node pairing is not available on this gateway instance.", data: null };
  }
  const status = toks[1]?.toLowerCase();
  const allowed = new Set(["pending", "approved", "denied", "revoked"]);
  const filter = status && allowed.has(status) ? status : undefined;
  const tenantId = resolveTenantId(deps);
  const payload = {
    pairings: await deps.nodePairingDal.list({ tenantId, status: filter as never, limit: 100 }),
  };
  return { output: jsonBlock(payload), data: payload };
}
