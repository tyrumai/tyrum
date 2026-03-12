/**
 * Ingress routes — Telegram webhook normalization + agent flow.
 */

import { Hono } from "hono";
import { normalizeUpdate, TelegramNormalizationError } from "../modules/ingress/telegram.js";
import { secureStringEqual } from "../utils/secure-string-equal.js";
import type { TelegramBot } from "../modules/ingress/telegram-bot.js";
import type { AgentRegistry } from "../modules/agent/registry.js";
import type { TelegramChannelQueue } from "../modules/channels/telegram.js";
import type { StoredTelegramChannelConfig } from "../modules/channels/channel-config-dal.js";
import {
  renderMarkdownForTelegram,
  type TelegramFormattingFallbackEvent,
} from "../modules/markdown/telegram.js";
import { resolveTelegramAgentId } from "../modules/channels/routing.js";
import type { RoutingConfigDal } from "../modules/channels/routing-config-dal.js";
import type { TelegramChannelRuntime } from "../modules/channels/telegram-runtime.js";
import type { MemoryV1Dal } from "../modules/memory/v1-dal.js";
import { recordMemoryV1SystemEpisode } from "../modules/memory/v1-episode-recorder.js";
import type { Logger } from "../modules/observability/logger.js";
import { DEFAULT_TENANT_ID } from "../modules/identity/scope.js";
import { safeDetail } from "../utils/safe-detail.js";

export interface IngressDeps {
  telegramRuntime?: TelegramChannelRuntime;
  telegramBot?: TelegramBot;
  telegramWebhookSecret?: string;
  telegramAllowedUserIds?: string[];
  agents?: AgentRegistry;
  telegramQueue?: TelegramChannelQueue;
  routingConfigDal?: RoutingConfigDal;
  memoryV1Dal?: MemoryV1Dal;
  logger?: Logger;
}

const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

function matchTelegramAccountByWebhookSecret(
  accounts: readonly StoredTelegramChannelConfig[],
  providedSecret: string,
): StoredTelegramChannelConfig | undefined {
  const normalizedSecret = providedSecret.trim();
  if (!normalizedSecret) return undefined;

  let matched: StoredTelegramChannelConfig | undefined;
  for (const account of accounts) {
    const webhookSecret = account.webhook_secret?.trim();
    if (!webhookSecret) continue;
    if (secureStringEqual(webhookSecret, normalizedSecret) && !matched) {
      matched = account;
    }
  }
  return matched;
}

export function createIngressRoutes(deps: IngressDeps = {}): Hono {
  const ingressRouter = new Hono();

  ingressRouter.post("/ingress/telegram", async (c) => {
    let telegramBot = deps.telegramBot;
    let telegramAllowedUserIds = deps.telegramAllowedUserIds ?? [];
    let telegramAccountKey = "default";
    let telegramPipelineEnabled = true;

    if (deps.telegramRuntime) {
      const accounts = await deps.telegramRuntime.listTelegramAccounts(DEFAULT_TENANT_ID);
      const botBackedAccounts = accounts.filter((account) => Boolean(account.bot_token?.trim()));
      const botBackedAccountsWithSecret = botBackedAccounts.filter((account) =>
        Boolean(account.webhook_secret?.trim()),
      );

      if (botBackedAccounts.length === 0) {
        return c.json(
          {
            error: "misconfigured",
            message: "Telegram bot token must be configured when Telegram ingress is enabled.",
          },
          503,
        );
      }

      if (botBackedAccountsWithSecret.length === 0) {
        return c.json(
          {
            error: "misconfigured",
            message: "Telegram webhook secret must be configured when Telegram ingress is enabled.",
          },
          503,
        );
      }

      const providedSecret = c.req.header(TELEGRAM_SECRET_HEADER);
      if (!providedSecret) {
        return c.json({ error: "unauthorized", message: "invalid telegram webhook secret" }, 401);
      }

      const matchedAccount = matchTelegramAccountByWebhookSecret(accounts, providedSecret);
      if (!matchedAccount || !matchedAccount.webhook_secret) {
        return c.json({ error: "unauthorized", message: "invalid telegram webhook secret" }, 401);
      }

      const matchedBot = deps.telegramRuntime.getBotForTelegramAccount({
        tenantId: DEFAULT_TENANT_ID,
        account: matchedAccount,
      });
      if (!matchedBot) {
        return c.json(
          {
            error: "misconfigured",
            message: "Telegram bot token must be configured when Telegram ingress is enabled.",
          },
          503,
        );
      }

      telegramBot = matchedBot;
      telegramAllowedUserIds = matchedAccount.allowed_user_ids;
      telegramAccountKey = matchedAccount.account_key;
      telegramPipelineEnabled = matchedAccount.pipeline_enabled ?? true;
    } else if (deps.telegramBot) {
      // When Telegram integration is enabled, require Telegram webhook secret validation.
      const expectedSecret = deps.telegramWebhookSecret?.trim();
      if (!expectedSecret) {
        return c.json(
          {
            error: "misconfigured",
            message: "Telegram webhook secret must be configured when Telegram ingress is enabled.",
          },
          503,
        );
      }

      const providedSecret = c.req.header(TELEGRAM_SECRET_HEADER);
      if (!providedSecret || !secureStringEqual(providedSecret, expectedSecret)) {
        return c.json({ error: "unauthorized", message: "invalid telegram webhook secret" }, 401);
      }
    }

    const rawBody = await c.req.text();

    if (!rawBody) {
      return c.json({ error: "invalid_request", message: "request body is empty" }, 400);
    }

    let normalized;
    try {
      normalized = normalizeUpdate(rawBody);
    } catch (err) {
      if (err instanceof TelegramNormalizationError) {
        return c.json({ error: "normalization_error", message: err.message }, 400);
      }
      throw err;
    }

    if (telegramAllowedUserIds.length > 0) {
      const senderId = normalized.message.sender?.id?.trim();
      if (!senderId || !telegramAllowedUserIds.includes(senderId)) {
        deps.logger?.info("ingress.telegram.sender_blocked", {
          sender_id: senderId ?? "unknown",
          reason: "telegram_user_not_allowlisted",
          account_key: telegramAccountKey,
        });
        return c.json({ ok: true, ignored: true, reason: "sender_not_allowlisted" }, 200);
      }
    }

    // If no agent runtime, return normalized message (legacy behavior)
    if (!deps.agents || !telegramBot) {
      return c.json(normalized);
    }

    const chatId = normalized.thread.id;
    const envelope = normalized.message.envelope;
    if (!envelope) {
      // Envelope omitted when connector content is empty (e.g., whitespace-only text).
      return c.json({ ok: true });
    }

    let durable;
    if (deps.routingConfigDal) {
      try {
        durable = await deps.routingConfigDal.getLatest(DEFAULT_TENANT_ID);
      } catch (err) {
        deps.logger?.warn("ingress.telegram.routing_config_load_failed", {
          error: safeDetail(err) ?? "unknown_error",
        });
        durable = undefined;
      }
    }
    const routing = durable?.config ?? { v: 1 };
    const routedAgentId =
      c.req.query("agent_key")?.trim() ||
      resolveTelegramAgentId(routing, telegramAccountKey, chatId);

    if (deps.telegramQueue && telegramPipelineEnabled) {
      try {
        const enqueued = await deps.telegramQueue.enqueue(normalized, {
          agentId: routedAgentId,
          accountId: telegramAccountKey,
        });
        return c.json({
          ok: true,
          queued: enqueued.inbox.status === "queued" || enqueued.inbox.status === "processing",
          inbox_id: enqueued.inbox.inbox_id,
          deduped: enqueued.deduped,
          status: enqueued.inbox.status,
        });
      } catch (err) {
        void err;
        return c.json(
          {
            error: "temporary_failure",
            message: "failed to queue telegram update; please retry",
          },
          503,
        );
      }
    }

    try {
      const runtime = await deps.agents.getRuntime({
        tenantId: DEFAULT_TENANT_ID,
        agentKey: routedAgentId,
      });
      const patchedEnvelope = {
        ...envelope,
        delivery: {
          ...envelope.delivery,
          channel: "telegram",
          account: telegramAccountKey,
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

      if (deps.memoryV1Dal && formattingFallbacks.length > 0) {
        const occurredAt = new Date().toISOString();
        const settled = await Promise.allSettled(
          formattingFallbacks.map(async (fallback) => {
            await recordMemoryV1SystemEpisode(
              deps.memoryV1Dal!,
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

        for (let index = 0; index < settled.length; index++) {
          const outcome = settled[index];
          if (outcome?.status !== "rejected") continue;
          const fallback = formattingFallbacks[index];
          deps.logger?.warn("memory.v1.system_episode_record_failed", {
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

      for (const chunk of chunks) {
        await telegramBot.sendMessage(chatId, chunk, { parse_mode: "HTML" });
      }
      return c.json({ ok: true, session_id: result.session_id });
    } catch (err) {
      deps.logger?.warn("ingress.telegram.agent_turn_failed", {
        agent_id: routedAgentId,
        thread_id: chatId,
        account_key: telegramAccountKey,
        error: safeDetail(err) ?? "unknown_error",
      });
      try {
        await telegramBot.sendMessage(
          chatId,
          "Sorry, something went wrong. Please try again later.",
          { parse_mode: "HTML" },
        );
      } catch (sendErr) {
        deps.logger?.warn("ingress.telegram.error_message_send_failed", {
          agent_id: routedAgentId,
          thread_id: chatId,
          account_key: telegramAccountKey,
          error: safeDetail(sendErr) ?? "unknown_error",
        });
      }
      return c.json({ ok: true, error: "agent_error" });
    }
  });

  return ingressRouter;
}
