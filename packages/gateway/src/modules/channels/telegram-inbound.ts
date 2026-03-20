import { normalizeUpdate, normalizeUpdateWithMedia } from "../ingress/telegram.js";
import type { TelegramBot } from "../ingress/telegram-bot.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { TelegramChannelQueue } from "./telegram.js";
import {
  renderMarkdownForTelegram,
  type TelegramFormattingFallbackEvent,
} from "../markdown/telegram.js";
import { resolveTelegramAgentId } from "./routing.js";
import type { RoutingConfigDal } from "./routing-config-dal.js";
import type { MemoryDal } from "../memory/memory-dal.js";
import { recordMemorySystemEpisode } from "../memory/memory-episode-recorder.js";
import type { Logger } from "../observability/logger.js";
import { safeDetail } from "../../utils/safe-detail.js";
import type { ArtifactStore } from "../artifact/store.js";
import { createTelegramEgressConnector } from "./telegram-shared.js";
import type { IdentityScopeDal } from "../identity/scope.js";

export interface TelegramInboundAccount {
  accountKey: string;
  agentKey?: string;
  allowedUserIds: readonly string[];
  pipelineEnabled: boolean;
}

export type TelegramInboundResult =
  | { kind: "normalized"; normalized: ReturnType<typeof normalizeUpdate> }
  | { kind: "ignored"; reason: "sender_not_allowlisted" | "empty_content" }
  | {
      kind: "queued";
      inbox_id: number;
      deduped: boolean;
      status: string;
      queued: boolean;
    }
  | { kind: "replied"; session_id: string }
  | { kind: "agent_error" };

export class TelegramInboundTemporaryFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramInboundTemporaryFailure";
  }
}

export async function processTelegramInboundUpdate(input: {
  rawBody: string;
  tenantId: string;
  account: TelegramInboundAccount;
  telegramBot?: TelegramBot;
  agents?: AgentRegistry;
  telegramQueue?: TelegramChannelQueue;
  routingConfigDal?: RoutingConfigDal;
  identityScopeDal?: IdentityScopeDal;
  memoryDal?: MemoryDal;
  artifactStore?: ArtifactStore;
  maxUploadBytes?: number;
  logger?: Logger;
}): Promise<TelegramInboundResult> {
  const normalized =
    input.telegramBot && input.artifactStore
      ? await normalizeUpdateWithMedia(input.rawBody, {
          telegramBot: input.telegramBot,
          artifactStore: input.artifactStore,
          maxUploadBytes: input.maxUploadBytes,
        })
      : normalizeUpdate(input.rawBody);

  if (input.account.allowedUserIds.length > 0) {
    const senderId = normalized.message.sender?.id?.trim();
    if (!senderId || !input.account.allowedUserIds.includes(senderId)) {
      input.logger?.info("ingress.telegram.sender_blocked", {
        sender_id: senderId ?? "unknown",
        reason: "telegram_user_not_allowlisted",
        account_key: input.account.accountKey,
      });
      return { kind: "ignored", reason: "sender_not_allowlisted" };
    }
  }

  if (!input.agents || !input.telegramBot) {
    return { kind: "normalized", normalized };
  }

  const chatId = normalized.thread.id;
  const envelope = normalized.message.envelope;
  if (!envelope) {
    return { kind: "ignored", reason: "empty_content" };
  }

  let durable;
  if (input.routingConfigDal) {
    try {
      durable = await input.routingConfigDal.getLatest(input.tenantId);
    } catch (err) {
      input.logger?.warn("ingress.telegram.routing_config_load_failed", {
        error: safeDetail(err) ?? "unknown_error",
      });
      durable = undefined;
    }
  }
  const routing = durable?.config ?? { v: 1 };
  const routedAgentId =
    input.account.agentKey?.trim() ||
    (await resolveTelegramAgentId({
      config: routing,
      tenantId: input.tenantId,
      accountKey: input.account.accountKey,
      threadId: chatId,
      identityScopeDal:
        input.identityScopeDal ??
        (() => {
          throw new Error("identity scope is required to resolve the primary telegram agent");
        })(),
    }));

  if (input.telegramQueue && input.account.pipelineEnabled) {
    try {
      const enqueued = await input.telegramQueue.enqueue(normalized, {
        agentId: routedAgentId,
        accountId: input.account.accountKey,
      });
      return {
        kind: "queued",
        queued: enqueued.inbox.status === "queued" || enqueued.inbox.status === "processing",
        inbox_id: enqueued.inbox.inbox_id,
        deduped: enqueued.deduped,
        status: enqueued.inbox.status,
      };
    } catch {
      throw new TelegramInboundTemporaryFailure("failed to queue telegram update; please retry");
    }
  }

  try {
    const runtime = await input.agents.getRuntime({
      tenantId: input.tenantId,
      agentKey: routedAgentId,
    });
    const patchedEnvelope = {
      ...envelope,
      delivery: {
        ...envelope.delivery,
        channel: "telegram" as const,
        account: input.account.accountKey,
      },
    };
    const result = await runtime.turn({
      channel: "telegram",
      thread_id: chatId,
      envelope: patchedEnvelope,
    });

    const formattingFallbacks: TelegramFormattingFallbackEvent[] = [];
    const chunks = renderMarkdownForTelegram(result.reply, {
      onFormattingFallback: (event) => {
        formattingFallbacks.push(event);
      },
    });

    if (input.memoryDal && formattingFallbacks.length > 0) {
      const occurredAt = new Date().toISOString();
      const settled = await Promise.allSettled(
        formattingFallbacks.map(async (fallback) => {
          await recordMemorySystemEpisode(
            input.memoryDal!,
            {
              occurred_at: occurredAt,
              channel: "telegram",
              event_type: "channel_formatting_fallback",
              summary_md: `Telegram formatting fallback: ${fallback.reason}`,
              tags: ["channel", "telegram", "formatting_fallback"],
              metadata: {
                mode: "direct",
                agent_id: routedAgentId,
                session_id: result.session_id,
                reason: fallback.reason,
                chunk_index: fallback.chunk_index,
                ...(fallback.detail ? { detail: fallback.detail } : {}),
              },
            },
            routedAgentId,
          );
        }),
      );

      for (let index = 0; index < settled.length; index += 1) {
        const outcome = settled[index];
        if (outcome?.status !== "rejected") continue;
        const fallback = formattingFallbacks[index];
        input.logger?.warn("memory.system_episode_record_failed", {
          agent_id: routedAgentId,
          session_id: result.session_id,
          event_type: "channel_formatting_fallback",
          reason: fallback?.reason,
          chunk_index: fallback?.chunk_index,
          detail: fallback?.detail,
          error: safeDetail(outcome.reason) ?? "unknown_error",
        });
      }
    }

    const connector = createTelegramEgressConnector(
      input.telegramBot,
      input.account.accountKey,
      input.artifactStore,
    );
    const attachments = result.attachments ?? [];
    if (chunks.length === 0 && attachments.length === 0) {
      return { kind: "replied", session_id: result.session_id };
    }

    const egressChunks = chunks.length > 0 ? chunks : [""];
    for (let index = 0; index < egressChunks.length; index += 1) {
      const chunk = egressChunks[index]!;
      await connector.sendMessage({
        accountId: input.account.accountKey,
        containerId: chatId,
        content: {
          ...(chunk.length > 0 ? { text: chunk } : {}),
          ...(index === 0 && attachments.length > 0 ? { attachments } : {}),
        },
        parseMode: "HTML",
      });
    }
    return { kind: "replied", session_id: result.session_id };
  } catch (err) {
    input.logger?.warn("ingress.telegram.agent_turn_failed", {
      agent_id: routedAgentId,
      thread_id: chatId,
      account_key: input.account.accountKey,
      error: safeDetail(err) ?? "unknown_error",
    });
    try {
      await input.telegramBot.sendMessage(
        chatId,
        "Sorry, something went wrong. Please try again later.",
        { parse_mode: "HTML" },
      );
    } catch (sendErr) {
      input.logger?.warn("ingress.telegram.error_message_send_failed", {
        agent_id: routedAgentId,
        thread_id: chatId,
        account_key: input.account.accountKey,
        error: safeDetail(sendErr) ?? "unknown_error",
      });
    }
    return { kind: "agent_error" };
  }
}
