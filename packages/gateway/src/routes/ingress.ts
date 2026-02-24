/**
 * Ingress routes — Telegram webhook normalization + agent flow.
 */

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  normalizeUpdate,
  TelegramNormalizationError,
} from "../modules/ingress/telegram.js";
import { secureStringEqual } from "../utils/secure-string-equal.js";
import type { TelegramBot } from "../modules/ingress/telegram-bot.js";
import type { AgentRegistry } from "../modules/agent/registry.js";
import type { TelegramChannelQueue } from "../modules/channels/telegram.js";
import { renderMarkdownForTelegram, type TelegramFormattingFallbackEvent } from "../modules/markdown/telegram.js";
import { loadRoutingConfig, resolveTelegramAgentId } from "../modules/channels/routing.js";
import type { MemoryDal } from "../modules/memory/dal.js";

export interface IngressDeps {
  telegramBot?: TelegramBot;
  agents?: AgentRegistry;
  telegramQueue?: TelegramChannelQueue;
  memoryDal?: MemoryDal;
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

    const chatId = normalized.thread.id;
    const envelope = normalized.message.envelope;
    if (!envelope) {
      // Envelope omitted when connector content is empty (e.g., whitespace-only text).
      return c.json({ ok: true });
    }

    const home = deps.home?.trim() || process.env["TYRUM_HOME"]?.trim() || undefined;
    const routing = home ? await loadRoutingConfig(home) : { v: 1 };
    const routedAgentId = c.req.query("agent_id")?.trim() || resolveTelegramAgentId(routing, chatId);

    if (deps.telegramQueue) {
      try {
        const enqueued = await deps.telegramQueue.enqueue(normalized, {
          agentId: routedAgentId,
        });
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
      const patchedEnvelope = {
        ...envelope,
        delivery: {
          ...envelope.delivery,
          channel: "telegram",
          account: "default",
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
        await Promise.allSettled(
          formattingFallbacks.map(async (fallback) => {
            await deps.memoryDal?.insertEpisodicEvent(
              `channel-formatting-fallback-${randomUUID()}`,
              occurredAt,
              "telegram",
              "channel_formatting_fallback",
              {
                mode: "direct",
                agent_id: routedAgentId,
                session_id: result.session_id,
                reason: fallback.reason,
                chunk_index: fallback.chunk_index,
                ...(fallback.detail ? { detail: fallback.detail } : {}),
              },
              routedAgentId,
            );
          }),
        );
      }

      for (const chunk of chunks) {
        await deps.telegramBot.sendMessage(chatId, chunk, { parse_mode: "HTML" });
      }
      return c.json({ ok: true, session_id: result.session_id });
    } catch {
      try {
        await deps.telegramBot.sendMessage(
          chatId,
          "Sorry, something went wrong. Please try again later.",
          { parse_mode: "HTML" },
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
