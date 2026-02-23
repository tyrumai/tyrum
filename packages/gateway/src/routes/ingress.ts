/**
 * Ingress routes — Telegram webhook normalization + agent flow.
 */

import { Hono } from "hono";
import {
  normalizeUpdate,
  TelegramNormalizationError,
} from "../modules/ingress/telegram.js";
import { secureStringEqual } from "../utils/secure-string-equal.js";
import type { TelegramBot } from "../modules/ingress/telegram-bot.js";
import type { AgentRegistry } from "../modules/agent/registry.js";
import type { TelegramChannelQueue } from "../modules/channels/telegram.js";
import { renderMarkdownForTelegram } from "../modules/markdown/telegram.js";
import { loadRoutingConfig, resolveTelegramAgentId } from "../modules/channels/routing.js";

export interface IngressDeps {
  telegramBot?: TelegramBot;
  agents?: AgentRegistry;
  telegramQueue?: TelegramChannelQueue;
  home?: string;
}

const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

export function createIngressRoutes(deps: IngressDeps = {}): Hono {
  const ingressRouter = new Hono();

  ingressRouter.post("/ingress/telegram", async (c) => {
    // When Telegram integration is enabled, require Telegram webhook secret validation.
    if (deps.telegramBot) {
      const expectedSecret = process.env["TELEGRAM_WEBHOOK_SECRET"]?.trim();
      if (!expectedSecret) {
        return c.json(
          {
            error: "misconfigured",
            message:
              "TELEGRAM_WEBHOOK_SECRET must be set when Telegram ingress is enabled.",
          },
          503,
        );
      }

      const providedSecret = c.req.header(TELEGRAM_SECRET_HEADER);
      if (!providedSecret || !secureStringEqual(providedSecret, expectedSecret)) {
        return c.json(
          { error: "unauthorized", message: "invalid telegram webhook secret" },
          401,
        );
      }
    }

    const rawBody = await c.req.text();

    if (!rawBody) {
      return c.json(
        { error: "invalid_request", message: "request body is empty" },
        400,
      );
    }

    let normalized;
    try {
      normalized = normalizeUpdate(rawBody);
    } catch (err) {
      if (err instanceof TelegramNormalizationError) {
        return c.json(
          { error: "normalization_error", message: err.message },
          400,
        );
      }
      throw err;
    }

    // If no agent runtime, return normalized message (legacy behavior)
    if (!deps.agents || !deps.telegramBot) {
      return c.json(normalized);
    }

    // Extract text from the normalized message
    const chatId = normalized.thread.id;
    const messageText =
      normalized.message.content.kind === "text"
        ? normalized.message.content.text
        : normalized.message.content.caption ?? "";

    if (!messageText) {
      // Non-text messages without captions — acknowledge silently
      return c.json({ ok: true });
    }

    const home = deps.home?.trim() || process.env["TYRUM_HOME"]?.trim() || undefined;
    const routing = home ? await loadRoutingConfig(home) : { v: 1 };
    const routedAgentId = c.req.query("agent_id")?.trim() || resolveTelegramAgentId(routing, chatId);

    if (deps.telegramQueue) {
      try {
        const enqueued = await deps.telegramQueue.enqueue(normalized, { agentId: routedAgentId });
        return c.json({
          ok: true,
          queued: enqueued.inbox.status === "queued" || enqueued.inbox.status === "processing",
          inbox_id: enqueued.inbox.inbox_id,
          deduped: enqueued.deduped,
          status: enqueued.inbox.status,
        });
      } catch {
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
      const runtime = await deps.agents.getRuntime(routedAgentId);
      const result = await runtime.turn({
        channel: "telegram",
        thread_id: chatId,
        message: messageText,
      });

      const chunks = renderMarkdownForTelegram(result.reply);
      for (const chunk of chunks) {
        await deps.telegramBot.sendMessage(chatId, chunk);
      }
      return c.json({ ok: true, session_id: result.session_id });
    } catch {
      try {
        await deps.telegramBot.sendMessage(
          chatId,
          "Sorry, something went wrong. Please try again later.",
        );
      } catch {
        // If we can't even send the error message, just return 200 to Telegram
      }
      return c.json({ ok: true, error: "agent_error" });
    }
  });

  return ingressRouter;
}

// Backward-compatible export for existing consumers
export const ingress = createIngressRoutes();
