/**
 * Ingress routes — channel webhook normalization + agent flow.
 */

import { Hono } from "hono";
import {
  normalizeUpdate,
  normalizeUpdateWithMedia,
  TelegramNormalizationError,
} from "../modules/ingress/telegram.js";
import {
  buildGoogleChatEnvelope,
  extractGoogleChatText,
  parseGoogleChatEvent,
  GoogleChatNormalizationError,
} from "../modules/ingress/googlechat.js";
import { verifyGoogleChatRequest } from "../modules/ingress/googlechat-auth.js";
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
import { createTelegramEgressConnector } from "../modules/channels/telegram-shared.js";
import type { RoutingConfigDal } from "../modules/channels/routing-config-dal.js";
import type { TelegramChannelRuntime } from "../modules/channels/telegram-runtime.js";
import type { GoogleChatChannelRuntime } from "../modules/channels/googlechat-runtime.js";
import type { MemoryDal } from "../modules/memory/memory-dal.js";
import { recordMemorySystemEpisode } from "../modules/memory/memory-episode-recorder.js";
import type { Logger } from "../modules/observability/logger.js";
import { DEFAULT_TENANT_ID } from "../modules/identity/scope.js";
import { safeDetail } from "../utils/safe-detail.js";
import type { ArtifactStore } from "../modules/artifact/store.js";

export interface IngressDeps {
  telegramRuntime?: TelegramChannelRuntime;
  googleChatRuntime?: GoogleChatChannelRuntime;
  telegramBot?: TelegramBot;
  telegramWebhookSecret?: string;
  telegramAllowedUserIds?: string[];
  agents?: AgentRegistry;
  telegramQueue?: TelegramChannelQueue;
  routingConfigDal?: RoutingConfigDal;
  memoryDal?: MemoryDal;
  artifactStore?: ArtifactStore;
  artifactMaxUploadBytes?: number;
  logger?: Logger;
}

const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

function extractBearerToken(headerValue: string | undefined): string | undefined {
  const raw = headerValue?.trim();
  if (!raw) return undefined;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

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
      normalized =
        telegramBot && deps.artifactStore
          ? await normalizeUpdateWithMedia(rawBody, {
              telegramBot,
              artifactStore: deps.artifactStore,
              maxUploadBytes: deps.artifactMaxUploadBytes,
            })
          : normalizeUpdate(rawBody);
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
    if (deps.routingConfigDal && (!deps.telegramRuntime || telegramBot)) {
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
    const storedTelegramAccount = deps.telegramRuntime
      ? await deps.telegramRuntime.getTelegramAccountByAccountKey({
          tenantId: DEFAULT_TENANT_ID,
          accountKey: telegramAccountKey,
        })
      : undefined;
    const storedAgentKey = storedTelegramAccount?.agent_key?.trim();
    const routedFromLegacy = resolveTelegramAgentId(routing, telegramAccountKey, chatId);
    const routedAgentId = storedAgentKey || routedFromLegacy;

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

      if (deps.memoryDal && formattingFallbacks.length > 0) {
        const occurredAt = new Date().toISOString();
        const settled = await Promise.allSettled(
          formattingFallbacks.map(async (fallback) => {
            await recordMemorySystemEpisode(
              deps.memoryDal!,
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
          deps.logger?.warn("memory.system_episode_record_failed", {
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
        telegramBot,
        telegramAccountKey,
        deps.artifactStore,
      );
      const attachments = result.attachments ?? [];
      if (chunks.length === 0 && attachments.length === 0) {
        return c.json({ ok: true, session_id: result.session_id });
      }
      const egressChunks = chunks.length > 0 ? chunks : [""];
      for (let index = 0; index < egressChunks.length; index += 1) {
        const chunk = egressChunks[index]!;
        await connector.sendMessage({
          accountId: telegramAccountKey,
          containerId: chatId,
          content: {
            ...(chunk.length > 0 ? { text: chunk } : {}),
            ...(index === 0 && attachments.length > 0 ? { attachments } : {}),
          },
          parseMode: "HTML",
        });
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

  ingressRouter.post("/ingress/googlechat", async (c) => {
    const accounts = deps.googleChatRuntime
      ? await deps.googleChatRuntime.listGoogleChatAccounts(DEFAULT_TENANT_ID)
      : [];
    if (accounts.length === 0) {
      return c.json(
        {
          error: "misconfigured",
          message: "Google Chat accounts must be configured when Google Chat ingress is enabled.",
        },
        503,
      );
    }

    const bearer = extractBearerToken(c.req.header("authorization"));
    if (!bearer) {
      return c.json({ error: "unauthorized", message: "invalid google chat bearer" }, 401);
    }

    const verificationResults = await Promise.all(
      accounts.map(async (account) => ({
        account,
        verification: await verifyGoogleChatRequest({
          bearer,
          audienceType: account.audience_type,
          audience: account.audience,
        }),
      })),
    );
    const matchedAccounts = verificationResults
      .filter((result) => result.verification.ok)
      .map((result) => result.account);
    if (matchedAccounts.length !== 1) {
      return c.json({ error: "unauthorized", message: "invalid google chat bearer" }, 401);
    }

    const matchedAccount = matchedAccounts[0]!;
    const rawBody = await c.req.text();
    if (!rawBody) {
      return c.json({ error: "invalid_request", message: "request body is empty" }, 400);
    }

    let event;
    try {
      event = parseGoogleChatEvent(rawBody);
    } catch (err) {
      if (err instanceof GoogleChatNormalizationError) {
        return c.json({ error: "normalization_error", message: err.message }, 400);
      }
      throw err;
    }

    if ((event.type ?? "").trim().toUpperCase() !== "MESSAGE" || !event.message || !event.space) {
      return c.json({}, 200);
    }

    if (!deps.agents) {
      return c.json(event, 200);
    }

    let inbound;
    try {
      inbound = buildGoogleChatEnvelope({
        accountKey: matchedAccount.account_key,
        event,
      });
    } catch (err) {
      if (err instanceof GoogleChatNormalizationError) {
        return c.json({ error: "normalization_error", message: err.message }, 400);
      }
      throw err;
    }

    if (
      matchedAccount.allowed_users.length > 0 &&
      !matchedAccount.allowed_users.includes(inbound.senderId) &&
      (!inbound.senderEmail || !matchedAccount.allowed_users.includes(inbound.senderEmail))
    ) {
      deps.logger?.info("ingress.googlechat.sender_blocked", {
        sender_id: inbound.senderId,
        sender_email: inbound.senderEmail ?? null,
        account_key: matchedAccount.account_key,
        reason: "googlechat_user_not_allowlisted",
      });
      return c.json({}, 200);
    }

    if (inbound.senderType === "BOT" || inbound.senderId === "users/app") {
      return c.json({}, 200);
    }

    if (!extractGoogleChatText(event)) {
      return c.json({}, 200);
    }

    try {
      const runtime = await deps.agents.getRuntime({
        tenantId: DEFAULT_TENANT_ID,
        agentKey: matchedAccount.agent_key,
      });
      const result = await runtime.turn({
        channel: "googlechat",
        thread_id: inbound.containerId,
        envelope: inbound.envelope,
      });
      return c.json({ text: result.reply }, 200);
    } catch (err) {
      deps.logger?.warn("ingress.googlechat.agent_turn_failed", {
        account_key: matchedAccount.account_key,
        sender_id: inbound.senderId,
        container_id: inbound.containerId,
        agent_id: matchedAccount.agent_key,
        error: safeDetail(err) ?? "unknown_error",
      });
      return c.json({ text: "Sorry, something went wrong. Please try again later." }, 200);
    }
  });

  return ingressRouter;
}
