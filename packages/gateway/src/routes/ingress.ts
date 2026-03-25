/**
 * Ingress routes — channel webhook normalization + agent flow.
 */

import { Hono } from "hono";
import { TelegramNormalizationError } from "../app/modules/ingress/telegram.js";
import {
  buildGoogleChatEnvelope,
  extractGoogleChatText,
  parseGoogleChatEvent,
  GoogleChatNormalizationError,
} from "../app/modules/ingress/googlechat.js";
import { verifyGoogleChatRequest } from "../app/modules/ingress/googlechat-auth.js";
import { secureStringEqual } from "../utils/secure-string-equal.js";
import type { TelegramBot } from "../app/modules/ingress/telegram-bot.js";
import type { AgentRegistry } from "../app/modules/agent/registry.js";
import type { TelegramChannelQueue } from "../app/modules/channels/telegram.js";
import type { StoredTelegramChannelConfig } from "../app/modules/channels/channel-config-dal.js";
import type { RoutingConfigDal } from "../app/modules/channels/routing-config-dal.js";
import type { TelegramChannelRuntime } from "../app/modules/channels/telegram-runtime.js";
import type { GoogleChatChannelRuntime } from "../app/modules/channels/googlechat-runtime.js";
import type { MemoryDal } from "../app/modules/memory/memory-dal.js";
import type { Logger } from "../app/modules/observability/logger.js";
import { DEFAULT_TENANT_ID, type IdentityScopeDal } from "../app/modules/identity/scope.js";
import { safeDetail } from "../utils/safe-detail.js";
import type { ArtifactStore } from "../app/modules/artifact/store.js";
import {
  processTelegramInboundUpdate,
  TelegramInboundTemporaryFailure,
  type TelegramInboundAccount,
} from "../app/modules/channels/telegram-inbound.js";

export interface IngressDeps {
  telegramRuntime?: TelegramChannelRuntime;
  googleChatRuntime?: GoogleChatChannelRuntime;
  telegramBot?: TelegramBot;
  telegramWebhookSecret?: string;
  telegramAllowedUserIds?: string[];
  agents?: AgentRegistry;
  telegramQueue?: TelegramChannelQueue;
  routingConfigDal?: RoutingConfigDal;
  identityScopeDal?: IdentityScopeDal;
  memoryDal?: MemoryDal;
  artifactStore?: ArtifactStore;
  artifactMaxUploadBytes?: number;
  logger?: Logger;
}

const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

function hasConfiguredTelegramProcessing(deps: IngressDeps): boolean {
  return Boolean(deps.agents || deps.telegramQueue);
}

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
    let telegramAccount: TelegramInboundAccount = {
      accountKey: "default",
      allowedUserIds: deps.telegramAllowedUserIds ?? [],
      pipelineEnabled: true,
    };

    if (deps.telegramRuntime) {
      const accounts = await deps.telegramRuntime.listTelegramAccounts(DEFAULT_TENANT_ID);
      const webhookAccounts = accounts.filter((account) => account.ingress_mode === "webhook");
      const botBackedAccounts = webhookAccounts.filter((account) =>
        Boolean(account.bot_token?.trim()),
      );
      const botBackedAccountsWithSecret = botBackedAccounts.filter((account) =>
        Boolean(account.webhook_secret?.trim()),
      );

      if (webhookAccounts.length === 0) {
        return c.json(
          {
            error: "misconfigured",
            message:
              "Telegram webhook ingress requires at least one webhook-mode account when Telegram ingress is enabled.",
          },
          503,
        );
      }

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

      const matchedAccount = matchTelegramAccountByWebhookSecret(
        botBackedAccountsWithSecret,
        providedSecret,
      );
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
      telegramAccount = {
        accountKey: matchedAccount.account_key,
        agentKey: matchedAccount.agent_key,
        allowedUserIds: matchedAccount.allowed_user_ids,
        pipelineEnabled: matchedAccount.pipeline_enabled ?? true,
      };
    } else if (deps.telegramBot) {
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
    } else if (hasConfiguredTelegramProcessing(deps)) {
      return c.json(
        {
          error: "misconfigured",
          message: "Telegram runtime must be configured when Telegram ingress is enabled.",
        },
        503,
      );
    }

    const rawBody = await c.req.text();
    if (!rawBody) {
      return c.json({ error: "invalid_request", message: "request body is empty" }, 400);
    }

    try {
      const result = await processTelegramInboundUpdate({
        rawBody,
        tenantId: DEFAULT_TENANT_ID,
        account: telegramAccount,
        telegramBot,
        agents: deps.agents,
        telegramQueue: deps.telegramQueue,
        routingConfigDal: deps.routingConfigDal,
        identityScopeDal: deps.identityScopeDal,
        memoryDal: deps.memoryDal,
        artifactStore: deps.artifactStore,
        maxUploadBytes: deps.artifactMaxUploadBytes,
        logger: deps.logger,
      });
      switch (result.kind) {
        case "normalized":
          return c.json(result.normalized);
        case "ignored":
          return c.json({ ok: true, ignored: true, reason: result.reason }, 200);
        case "queued":
          return c.json(
            {
              ok: true,
              queued: result.queued,
              inbox_id: result.inbox_id,
              deduped: result.deduped,
              status: result.status,
            },
            200,
          );
        case "replied":
          return c.json({ ok: true, conversation_id: result.conversation_id });
        case "agent_error":
          return c.json({ ok: true, error: "agent_error" });
      }
    } catch (err) {
      if (err instanceof TelegramNormalizationError) {
        return c.json({ error: "normalization_error", message: err.message }, 400);
      }
      if (err instanceof TelegramInboundTemporaryFailure) {
        return c.json(
          {
            error: "temporary_failure",
            message: err.message,
          },
          503,
        );
      }
      throw err;
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
