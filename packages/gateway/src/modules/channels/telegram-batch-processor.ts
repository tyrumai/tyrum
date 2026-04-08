import { NormalizedThreadMessage as NormalizedThreadMessageSchema } from "@tyrum/contracts";
import { isSafeSuggestedOverridePattern, type PolicyService } from "@tyrum/runtime-policy";
import type { NormalizedMessageEnvelope } from "@tyrum/contracts";
import type { ChannelInboxRow } from "./inbox-dal.js";
import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import type { ChannelInboxDal } from "./inbox-dal.js";
import type { ChannelOutboxDal } from "./outbox-dal.js";
import { ConversationQueueInterruptError } from "../conversation-queue/queue-signal-dal.js";
import {
  renderMarkdownForTelegram,
  type TelegramFormattingFallbackEvent,
} from "../markdown/telegram.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { ApprovalDal } from "../approval/dal.js";
import { broadcastApprovalUpdated } from "../approval/update-broadcast.js";
import { createReviewedApproval } from "../review/review-init.js";
import type { MemoryDal } from "../memory/memory-dal.js";
import { recordMemorySystemEpisode } from "../memory/memory-episode-recorder.js";
import {
  type ChannelEgressConnector,
  DEFAULT_CHANNEL_ACCOUNT_ID,
  buildChannelSourceKey,
  parseChannelSourceKey,
} from "./interface.js";
import { ConversationSendPolicyOverrideDal } from "./send-policy-override-dal.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import type { ProtocolDeps } from "../../ws/protocol.js";
import {
  CHANNEL_TYPING_MESSAGE_START_DELAY_MS,
  type ChannelTypingMode,
  extractMessageText,
  isInteractiveConversationKey,
  mergeInboundEnvelopes,
} from "./telegram-shared.js";
import { resolveQueuedTelegramAgentId } from "./telegram-batch-support.js";
import { createTelegramBatchTypingController } from "./telegram-batch-typing.js";
import { emitTelegramDebugLog } from "./telegram-debug.js";

type TelegramBatchProcessorDeps = {
  db: SqlDb;
  inbox: ChannelInboxDal;
  outbox: ChannelOutboxDal;
  agents: AgentRegistry;
  egressConnectors: ReadonlyMap<string, ChannelEgressConnector>;
  owner: string;
  logger?: Logger;
  memoryDal?: MemoryDal;
  approvalDal?: ApprovalDal;
  protocolDeps?: ProtocolDeps;
  typingMode: ChannelTypingMode;
  typingRefreshMs: number;
  typingAutomationEnabled: boolean;
};

export async function processTelegramBatch(
  deps: TelegramBatchProcessorDeps,
  rows: ChannelInboxRow[],
): Promise<void> {
  const leader = rows[0]!;
  const address = parseChannelSourceKey(leader.source);
  const connectorId = address.connector;
  const accountId = address.accountId;
  const messages: string[] = [];
  const envelopes: NormalizedMessageEnvelope[] = [];
  let hasAttachments = false;

  for (const row of rows) {
    const parsed = NormalizedThreadMessageSchema.safeParse(row.payload);
    if (!parsed.success) continue;

    const envelope = parsed.data.message.envelope;
    if (envelope) {
      const patchedEnvelope = {
        ...envelope,
        delivery: {
          ...envelope.delivery,
          channel: connectorId,
          account: accountId,
        },
      };
      envelopes.push(patchedEnvelope);

      const text = patchedEnvelope.content.text?.trim();
      if (text) messages.push(text);

      if (patchedEnvelope.content.attachments.length > 0) {
        hasAttachments = true;
      }
      continue;
    }

    const text = extractMessageText(parsed.data).trim();
    if (text.length > 0) messages.push(text);
  }

  const combined = messages.join("\n\n").trim();
  const mergedEnvelope = mergeInboundEnvelopes(envelopes, combined);
  if (combined.length === 0 && !hasAttachments) {
    for (const row of rows) {
      await deps.inbox.markCompleted(row.inbox_id, deps.owner, "");
    }
    return;
  }

  const sourceKey = buildChannelSourceKey(address);
  const connector = deps.egressConnectors.get(sourceKey) ?? deps.egressConnectors.get(connectorId);
  const debugLoggingEnabled = connector?.debugLoggingEnabled === true;
  const typingMode = deps.typingMode;
  const typingRefreshMs = deps.typingRefreshMs;
  const typingEnabled =
    typingMode !== "never" &&
    (isInteractiveConversationKey(leader.key) || deps.typingAutomationEnabled) &&
    typeof connector?.sendTyping === "function";
  const typingController = createTelegramBatchTypingController({
    enabled: typingEnabled,
    refreshMs: typingRefreshMs,
    connectorId,
    threadId: leader.thread_id,
    messageId: leader.message_id,
    logger: deps.logger,
    sendTyping: async () => {
      await connector?.sendTyping?.({
        accountId,
        containerId: leader.thread_id,
      });
    },
  });

  let reply: string;
  let replyAttachments: import("@tyrum/contracts").ArtifactRef[] = [];
  const agentId = resolveQueuedTelegramAgentId(leader.key);
  try {
    const runtime = await deps.agents.getRuntime({
      tenantId: DEFAULT_TENANT_ID,
      agentKey: agentId,
    });

    emitTelegramDebugLog({
      logger: deps.logger,
      enabled: debugLoggingEnabled,
      accountKey: accountId,
      event: "turn_started",
      fields: {
        mode: "queued",
        agent_id: agentId,
        thread_id: leader.thread_id,
        inbox_id: leader.inbox_id,
        conversation_key: leader.key,
        message_count: rows.length,
      },
    });

    if (typingMode === "instant" || typingMode === "thinking") {
      typingController.startNow();
    } else if (typingMode === "message") {
      typingController.scheduleStart(CHANNEL_TYPING_MESSAGE_START_DELAY_MS);
    }
    const result = await runtime.turn({
      ...(mergedEnvelope
        ? { envelope: mergedEnvelope }
        : { parts: [{ type: "text" as const, text: combined }] }),
      metadata: {
        tyrum_key: leader.key,
      },
      channel: connectorId,
      thread_id: leader.thread_id,
    });
    reply = result.reply ?? "";
    replyAttachments = result.attachments ?? [];
  } catch (err) {
    if (err instanceof ConversationQueueInterruptError) {
      deps.logger?.info("channels.ingress.agent_interrupted", {
        inbox_id: leader.inbox_id,
        channel_id: connectorId,
        source: leader.source,
        connector: connectorId,
        account_id: accountId,
        thread_id: leader.thread_id,
        message_id: leader.message_id,
        error: err.message,
      });
      emitTelegramDebugLog({
        logger: deps.logger,
        enabled: debugLoggingEnabled,
        accountKey: accountId,
        event: "turn_interrupted",
        fields: {
          mode: "queued",
          agent_id: agentId,
          thread_id: leader.thread_id,
          inbox_id: leader.inbox_id,
          conversation_key: leader.key,
          error: err.message,
        },
      });
      for (const row of rows) {
        await deps.inbox.markCompleted(row.inbox_id, deps.owner, "");
      }
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.warn("channels.ingress.agent_failed", {
      inbox_id: leader.inbox_id,
      channel_id: connectorId,
      source: leader.source,
      connector: connectorId,
      account_id: accountId,
      thread_id: leader.thread_id,
      message_id: leader.message_id,
      error: message,
    });
    emitTelegramDebugLog({
      logger: deps.logger,
      enabled: debugLoggingEnabled,
      accountKey: accountId,
      event: "turn_failed",
      fields: {
        mode: "queued",
        agent_id: agentId,
        thread_id: leader.thread_id,
        inbox_id: leader.inbox_id,
        conversation_key: leader.key,
        error: message,
      },
    });
    if (connector) {
      await connector
        .sendMessage({
          accountId,
          containerId: leader.thread_id,
          content: {
            text: "Sorry, something went wrong. Please try again later.",
            attachments: [],
          },
          parseMode: "HTML",
        })
        .catch((sendErr) => {
          const message2 = sendErr instanceof Error ? sendErr.message : String(sendErr);
          deps.logger?.warn("channels.telegram.send_error_reply_failed", {
            channel_id: connectorId,
            message_id: leader.message_id,
            thread_id: leader.thread_id,
            error: message2,
          });
        });
    }
    for (const row of rows) {
      await deps.inbox.markFailed(row.inbox_id, deps.owner, message);
    }
    return;
  } finally {
    typingController.stop();
  }

  emitTelegramDebugLog({
    logger: deps.logger,
    enabled: debugLoggingEnabled,
    accountKey: accountId,
    event: "turn_completed",
    fields: {
      mode: "queued",
      agent_id: agentId,
      thread_id: leader.thread_id,
      inbox_id: leader.inbox_id,
      conversation_key: leader.key,
      reply_length: reply.length,
      attachment_count: replyAttachments.length,
    },
  });

  const sendOverride = await new ConversationSendPolicyOverrideDal(deps.db).get({
    key: leader.key,
  });
  if (sendOverride?.send_policy === "off") {
    for (const row of rows) {
      await deps.inbox.markCompleted(row.inbox_id, deps.owner, reply);
    }
    return;
  }

  const formattingFallbacks: TelegramFormattingFallbackEvent[] = [];
  const chunks = renderMarkdownForTelegram(reply, {
    onFormattingFallback: (event) => {
      formattingFallbacks.push(event);
    },
  });
  if (chunks.length === 0 && replyAttachments.length === 0) {
    for (const row of rows) {
      await deps.inbox.markCompleted(row.inbox_id, deps.owner, reply);
    }
    return;
  }

  const memoryDal = deps.memoryDal;
  if (memoryDal && formattingFallbacks.length > 0) {
    const occurredAt = new Date().toISOString();
    await Promise.allSettled(
      formattingFallbacks.map(async (fallback) => {
        await recordMemorySystemEpisode(
          memoryDal,
          {
            occurred_at: occurredAt,
            channel: connectorId,
            event_type: "channel_formatting_fallback",
            summary_md: `Telegram formatting fallback: ${fallback.reason}`,
            tags: ["channel", "telegram", "formatting_fallback"],
            metadata: {
              mode: "pipeline",
              agent_id: agentId,
              inbox_id: leader.inbox_id,
              source: leader.source,
              reason: fallback.reason,
              chunk_index: fallback.chunk_index,
              ...(fallback.detail ? { detail: fallback.detail } : {}),
            },
          },
          agentId,
        );
      }),
    );
  }
  const source = connectorId;

  const conversationScope = await deps.db.get<{ agent_id: string; workspace_id: string }>(
    `SELECT agent_id, workspace_id
     FROM conversations
     WHERE tenant_id = ? AND conversation_id = ?
     LIMIT 1`,
    [leader.tenant_id, leader.conversation_id],
  );
  if (!conversationScope) {
    for (const row of rows) {
      await deps.inbox.markFailed(row.inbox_id, deps.owner, "conversation not found");
    }
    return;
  }

  let decision: "allow" | "deny" | "require_approval" = "allow";
  let policySnapshotId: string | undefined;
  let connectorMatchTarget: string | undefined;
  let appliedOverrideIds: string[] | undefined;
  const policyService =
    typeof (deps.agents as unknown as { getPolicyService?: (id: string) => PolicyService })
      .getPolicyService === "function"
      ? deps.agents.getPolicyService(agentId)
      : undefined;
  if (policyService) {
    connectorMatchTarget =
      accountId === DEFAULT_CHANNEL_ACCOUNT_ID
        ? `${source}:${leader.thread_id}`
        : `${source}:${accountId}:${leader.thread_id}`;
    try {
      const evalRes = await policyService.evaluateConnectorAction({
        tenantId: leader.tenant_id,
        agentId: conversationScope.agent_id,
        workspaceId: conversationScope.workspace_id,
        matchTarget: connectorMatchTarget,
      });
      decision = evalRes.decision;
      policySnapshotId = evalRes.policy_snapshot?.policy_snapshot_id;
      appliedOverrideIds = evalRes.applied_override_ids;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.warn("channels.egress.policy_eval_failed", {
        channel_id: source,
        message_id: leader.message_id,
        inbox_id: leader.inbox_id,
        agent_id: agentId,
        account_id: accountId,
        thread_id: leader.thread_id,
        match_target: connectorMatchTarget,
        error: message,
      });
      decision = "require_approval";
    }

    if (decision === "allow" && appliedOverrideIds && appliedOverrideIds.length > 0) {
      deps.logger?.debug("channels.egress.policy_override_applied", {
        agent_id: agentId,
        inbox_id: leader.inbox_id,
        match_target: connectorMatchTarget,
        applied_override_ids: appliedOverrideIds,
      });
    }

    if (policyService.isObserveOnly()) {
      decision = "allow";
    }
  }

  if (sendOverride?.send_policy === "on") {
    decision = "allow";
  }

  if (policyService && !policyService.isObserveOnly() && decision === "deny") {
    for (const row of rows) {
      await deps.inbox.markFailed(row.inbox_id, deps.owner, "policy denied outbound send");
    }
    return;
  }

  let approvalId: string | undefined;
  if (decision === "require_approval" && (chunks.length > 0 || replyAttachments.length > 0)) {
    if (!deps.approvalDal) {
      for (const row of rows) {
        await deps.inbox.markFailed(
          row.inbox_id,
          deps.owner,
          "approval required but approvals are unavailable",
        );
      }
      return;
    }

    const suggestedOverrides =
      connectorMatchTarget &&
      policySnapshotId &&
      isSafeSuggestedOverridePattern(connectorMatchTarget)
        ? [{ tool_id: "connector.send", pattern: connectorMatchTarget }]
        : undefined;

    const planSource =
      accountId === DEFAULT_CHANNEL_ACCOUNT_ID ? connectorId : `${connectorId}@${accountId}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const approval = await createReviewedApproval({
      approvalDal: deps.approvalDal,
      policyService,
      emitUpdate: async (createdApproval) => {
        await broadcastApprovalUpdated({
          tenantId: leader.tenant_id,
          approval: createdApproval,
          protocolDeps: deps.protocolDeps,
        });
      },
      params: {
        tenantId: leader.tenant_id,
        agentId: conversationScope.agent_id,
        workspaceId: conversationScope.workspace_id,
        approvalKey: `connector:${planSource}:${leader.thread_id}:${leader.message_id}`,
        kind: "connector.send",
        prompt: `Approve sending a ${source} reply`,
        motivation: `The system wants to send a ${source} reply to the user thread.`,
        context: {
          source,
          account_id: accountId,
          thread_id: leader.thread_id,
          inbox_id: leader.inbox_id,
          key: leader.key,
          policy_snapshot_id: policySnapshotId,
          policy: policyService
            ? {
                policy_snapshot_id: policySnapshotId,
                agent_id: conversationScope.agent_id,
                workspace_id: conversationScope.workspace_id,
                suggested_overrides: suggestedOverrides,
                applied_override_ids: appliedOverrideIds,
              }
            : undefined,
          chunks: Math.max(chunks.length, 1),
          attachments: replyAttachments.length,
          preview: chunks[0] ?? "",
        },
        expiresAt,
      },
    });
    approvalId = approval.approval_id;
  }

  const egressChunks = chunks.length > 0 ? chunks : [""];
  for (let i = 0; i < egressChunks.length; i += 1) {
    const text = egressChunks[i]!;
    const dedupeKey = `${leader.source}:${leader.thread_id}:${leader.message_id}:reply:${String(i)}`;
    await deps.outbox.enqueue({
      tenant_id: leader.tenant_id,
      inbox_id: leader.inbox_id,
      source: leader.source,
      thread_id: leader.thread_id,
      dedupe_key: dedupeKey,
      chunk_index: i,
      text,
      attachments: i === 0 ? replyAttachments : [],
      parse_mode: "HTML",
      workspace_id: leader.workspace_id,
      conversation_id: leader.conversation_id,
      channel_thread_id: leader.channel_thread_id,
    });
  }

  if (approvalId) {
    await deps.outbox.setApprovalForInbox(leader.inbox_id, approvalId);
  }

  for (const row of rows) {
    await deps.inbox.markCompleted(row.inbox_id, deps.owner, reply);
  }
}
