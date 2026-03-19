import {
  NormalizedThreadMessage as NormalizedThreadMessageSchema,
  parseTyrumKey,
} from "@tyrum/contracts";
import type { NormalizedMessageEnvelope } from "@tyrum/contracts";
import type { ChannelInboxRow } from "./inbox-dal.js";
import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import type { ChannelInboxDal } from "./inbox-dal.js";
import type { ChannelOutboxDal } from "./outbox-dal.js";
import { LaneQueueInterruptError } from "../lanes/queue-signal-dal.js";
import {
  renderMarkdownForTelegram,
  type TelegramFormattingFallbackEvent,
} from "../markdown/telegram.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { ApprovalDal } from "../approval/dal.js";
import { broadcastApprovalUpdated } from "../approval/update-broadcast.js";
import type { PolicyService } from "../policy/service.js";
import { isSafeSuggestedOverridePattern } from "../policy/override-guardrails.js";
import { createReviewedApproval } from "../review/review-init.js";
import type { MemoryDal } from "../memory/memory-dal.js";
import { recordMemorySystemEpisode } from "../memory/memory-episode-recorder.js";
import {
  type ChannelEgressConnector,
  DEFAULT_CHANNEL_ACCOUNT_ID,
  buildChannelSourceKey,
  parseChannelSourceKey,
} from "./interface.js";
import { SessionSendPolicyOverrideDal } from "./send-policy-override-dal.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import type { ProtocolDeps } from "../../ws/protocol.js";
import {
  CHANNEL_TYPING_MESSAGE_START_DELAY_MS,
  type ChannelTypingMode,
  extractMessageText,
  mergeInboundEnvelopes,
} from "./telegram-shared.js";

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
  const typingMode = deps.typingMode;
  const typingRefreshMs = deps.typingRefreshMs;
  const typingEnabled =
    typingMode !== "never" &&
    (leader.lane === "main" || deps.typingAutomationEnabled) &&
    typeof connector?.sendTyping === "function";

  let typingTimeout: ReturnType<typeof setTimeout> | undefined;
  let typingInterval: ReturnType<typeof setInterval> | undefined;
  let typingStarted = false;
  const stopTyping = (): void => {
    typingStarted = false;
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      typingTimeout = undefined;
    }
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = undefined;
    }
  };

  const sendTyping = (): void => {
    if (!typingEnabled) return;
    connector
      ?.sendTyping?.({
        accountId,
        containerId: leader.thread_id,
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger?.debug("channels.telegram.send_typing_failed", {
          channel_id: connectorId,
          message_id: leader.message_id,
          thread_id: leader.thread_id,
          error: message,
        });
      });
  };

  const startTyping = (): void => {
    if (!typingEnabled) return;
    if (typingStarted) return;
    typingStarted = true;
    sendTyping();
    if (typingRefreshMs > 0) {
      typingInterval = setInterval(sendTyping, typingRefreshMs);
    }
  };

  let reply: string;
  let agentId = "default";
  try {
    try {
      const parsedKey = parseTyrumKey(leader.key as never);
      if (parsedKey.kind === "agent") {
        agentId = parsedKey.agent_key;
      }
    } catch (err) {
      void err;
    }

    const runtime = await deps.agents.getRuntime({
      tenantId: DEFAULT_TENANT_ID,
      agentKey: agentId,
    });

    if (typingMode === "instant" || typingMode === "thinking") startTyping();
    else if (typingMode === "message") {
      typingTimeout = setTimeout(startTyping, CHANNEL_TYPING_MESSAGE_START_DELAY_MS);
    }
    const result = await runtime.turn({
      ...(combined.length > 0 ? { message: combined } : {}),
      metadata: {
        tyrum_key: leader.key,
        lane: leader.lane,
      },
      envelope: mergedEnvelope,
      channel: connectorId,
      thread_id: leader.thread_id,
    });
    reply = result.reply ?? "";
  } catch (err) {
    if (err instanceof LaneQueueInterruptError) {
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
    if (connector) {
      await connector
        .sendMessage({
          accountId,
          containerId: leader.thread_id,
          text: "Sorry, something went wrong. Please try again later.",
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
    stopTyping();
  }

  const sendOverride = await new SessionSendPolicyOverrideDal(deps.db).get({ key: leader.key });
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

  const sessionScope = await deps.db.get<{ agent_id: string; workspace_id: string }>(
    `SELECT agent_id, workspace_id
     FROM sessions
     WHERE tenant_id = ? AND session_id = ?
     LIMIT 1`,
    [leader.tenant_id, leader.session_id],
  );
  if (!sessionScope) {
    for (const row of rows) {
      await deps.inbox.markFailed(row.inbox_id, deps.owner, "session not found");
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
        agentId: sessionScope.agent_id,
        workspaceId: sessionScope.workspace_id,
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
  if (decision === "require_approval" && chunks.length > 0) {
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
        agentId: sessionScope.agent_id,
        workspaceId: sessionScope.workspace_id,
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
          lane: leader.lane,
          policy_snapshot_id: policySnapshotId,
          policy: policyService
            ? {
                policy_snapshot_id: policySnapshotId,
                agent_id: sessionScope.agent_id,
                workspace_id: sessionScope.workspace_id,
                suggested_overrides: suggestedOverrides,
                applied_override_ids: appliedOverrideIds,
              }
            : undefined,
          chunks: chunks.length,
          preview: chunks[0] ?? "",
        },
        expiresAt,
      },
    });
    approvalId = approval.approval_id;
  }

  for (let i = 0; i < chunks.length; i += 1) {
    const text = chunks[i]!;
    const dedupeKey = `${leader.source}:${leader.thread_id}:${leader.message_id}:reply:${String(i)}`;
    await deps.outbox.enqueue({
      tenant_id: leader.tenant_id,
      inbox_id: leader.inbox_id,
      source: leader.source,
      thread_id: leader.thread_id,
      dedupe_key: dedupeKey,
      chunk_index: i,
      text,
      parse_mode: "HTML",
      workspace_id: leader.workspace_id,
      session_id: leader.session_id,
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
