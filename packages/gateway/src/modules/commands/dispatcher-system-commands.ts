import { DEFAULT_CHANNEL_ACCOUNT_ID, parseChannelSourceKey } from "../channels/interface.js";
import { ConversationQueueModeOverrideDal } from "../conversation-queue/queue-mode-override-dal.js";
import { ConversationSendPolicyOverrideDal } from "../channels/send-policy-override-dal.js";
import { resolveWorkspaceKey } from "../workspace/id.js";
import { randomUUID } from "node:crypto";
import type { CommandDeps, CommandExecuteResult } from "./dispatcher.js";
import {
  buildStatusPayload,
  buildDefaultCommandKey,
  cancelTurnsAndClearQueuedInbox,
  createConversationDal,
  helpText,
  jsonBlock,
  resolveAgentId,
  resolveChannelThread,
  resolveContainerKindFromConversationKey,
  resolveFallbackConversationKey,
  resolveConversationKey,
  resolveTenantId,
} from "./dispatcher-support.js";
import { IdentityScopeDal } from "../identity/scope.js";

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
    return { output: "Conversations are not available on this gateway instance.", data: null };

  const ctx = deps.commandContext;
  const agentId = await resolveAgentId(ctx, {
    tenantId: resolveTenantId(deps),
    identityScopeDal: new IdentityScopeDal(deps.db),
  });
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
  const conversation = await createConversationDal(deps.db).getOrCreate({
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
    conversation_id: conversation.conversation_id,
  };
  return { output: jsonBlock(payload), data: payload };
}

async function executeCompactCommand(deps: CommandDeps): Promise<CommandExecuteResult> {
  if (!deps.db)
    return { output: "Conversations are not available on this gateway instance.", data: null };
  if (!deps.agents) {
    return { output: "Compaction is not available on this gateway instance.", data: null };
  }

  const ctx = deps.commandContext;
  const agentId = await resolveAgentId(ctx, {
    tenantId: resolveTenantId(deps),
    identityScopeDal: new IdentityScopeDal(deps.db),
  });
  const resolved = await resolveChannelThread(deps.db, ctx);
  if (!resolved)
    return { output: "Usage: /compact (requires key or channel/thread context)", data: null };

  const conversation = await createConversationDal(deps.db).getOrCreate({
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
  const compacted = await runtime.compactConversation({
    conversationId: conversation.conversation_id,
  });
  const payload = {
    agent_id: agentId,
    conversation_id: conversation.conversation_id,
    dropped_messages: compacted.droppedMessages,
    kept_messages: compacted.keptMessages,
  };
  return { output: jsonBlock(payload), data: payload };
}

async function executeStopCommand(deps: CommandDeps): Promise<CommandExecuteResult> {
  if (!deps.db) return { output: "Stop is not available on this gateway instance.", data: null };

  const agentId = await resolveAgentId(deps.commandContext, {
    tenantId: resolveTenantId(deps),
    identityScopeDal: new IdentityScopeDal(deps.db),
  });
  const resolved =
    (await resolveConversationKey(deps.db, deps.commandContext)) ??
    (await resolveFallbackConversationKey(deps.db, deps.commandContext, agentId));
  if (!resolved)
    return { output: "Usage: /stop (requires key or channel/thread context)", data: null };

  const stopped = await cancelTurnsAndClearQueuedInbox({
    db: deps.db,
    turnController: deps.turnController,
    policyService: deps.policyService,
    key: resolved.key,
    turnReason: "stopped by /stop",
    inboxReason: "cancelled by /stop",
  });
  const payload = {
    key: resolved.key,
    cancelled_turns: stopped.cancelledTurns,
    cleared_inbox: stopped.clearedInbox,
  };
  return { output: jsonBlock(payload), data: payload };
}

async function executeResetCommand(deps: CommandDeps): Promise<CommandExecuteResult> {
  if (!deps.db)
    return { output: "Conversations are not available on this gateway instance.", data: null };

  const ctx = deps.commandContext;
  const agentId = await resolveAgentId(ctx, {
    tenantId: resolveTenantId(deps),
    identityScopeDal: new IdentityScopeDal(deps.db),
  });
  const resolved = await resolveChannelThread(deps.db, ctx);
  if (!resolved)
    return { output: "Usage: /reset (requires key or channel/thread context)", data: null };

  const conversationKey = (await resolveConversationKey(deps.db, ctx)) ??
    (await resolveFallbackConversationKey(deps.db, ctx, agentId)) ?? {
      key: buildDefaultCommandKey({
        agentId,
        channel: resolved.channel,
        threadId: resolved.threadId,
      }),
    };
  const conversationDal = createConversationDal(deps.db);
  const conversation = await conversationDal.getOrCreate({
    scopeKeys: { agentKey: agentId, workspaceKey: resolveWorkspaceKey() },
    connectorKey: resolved.channel,
    accountKey: resolved.accountKey,
    providerThreadId: resolved.threadId,
    containerKind: resolveContainerKindFromConversationKey(conversationKey.key),
  });

  if (conversationKey.key) {
    await cancelTurnsAndClearQueuedInbox({
      db: deps.db,
      turnController: deps.turnController,
      policyService: deps.policyService,
      key: conversationKey.key,
      turnReason: "reset by /reset",
      inboxReason: "cancelled by /reset",
    });
  }

  await deps.db.transaction(async (tx) => {
    const conversationDalTx = createConversationDal(tx);
    const didReset = await conversationDalTx.reset({
      tenantId: conversation.tenant_id,
      conversationId: conversation.conversation_id,
    });
    if (!didReset) throw new Error(`Conversation ${conversation.conversation_id} not found`);

    await tx.run(
      `DELETE FROM conversation_model_overrides WHERE tenant_id = ? AND conversation_id = ?`,
      [conversation.tenant_id, conversation.conversation_id],
    );
    await tx.run(
      `DELETE FROM conversation_provider_pins WHERE tenant_id = ? AND conversation_id = ?`,
      [conversation.tenant_id, conversation.conversation_id],
    );
    await new ConversationQueueModeOverrideDal(tx).clear({ key: conversationKey.key });
    await new ConversationSendPolicyOverrideDal(tx).clear({ key: conversationKey.key });
  });

  const payload = { agent_id: agentId, conversation_id: conversation.conversation_id };
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
  const blockedStatuses = ["queued", "reviewing", "awaiting_human"] as const;
  const terminalStatuses = ["approved", "denied", "expired", "cancelled"] as const;
  const allowed = new Set<string>([...blockedStatuses, ...terminalStatuses]);
  const filter = status && allowed.has(status) ? status : undefined;
  const payload = {
    approvals: filter
      ? await deps.approvalDal.getByStatus({
          tenantId: resolveTenantId(deps),
          status: filter as never,
        })
      : await deps.approvalDal.listBlocked({ tenantId: resolveTenantId(deps) }),
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
  const allowed = new Set([
    "queued",
    "reviewing",
    "awaiting_human",
    "approved",
    "denied",
    "revoked",
  ]);
  const filter = status && allowed.has(status) ? status : undefined;
  const tenantId = resolveTenantId(deps);
  const payload = {
    pairings: await deps.nodePairingDal.list({ tenantId, status: filter as never, limit: 100 }),
  };
  return { output: jsonBlock(payload), data: payload };
}
