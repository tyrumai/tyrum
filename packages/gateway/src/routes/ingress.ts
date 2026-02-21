/**
 * Ingress routes — Telegram webhook normalization + agent flow.
 */

import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import {
  normalizeUpdate,
  TelegramNormalizationError,
} from "../modules/ingress/telegram.js";
import type { TelegramBot } from "../modules/ingress/telegram-bot.js";
import type { AgentRuntime } from "../modules/agent/runtime.js";
import type { ConnectorPipeline, NormalizedMessage } from "../modules/connector/pipeline.js";

export interface IngressDeps {
  telegramBot?: TelegramBot;
  agentRuntime?: AgentRuntime;
  connectorPipeline?: ConnectorPipeline;
}

const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

function secureStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

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

    // If connector pipeline is configured, run dedup
    if (deps.connectorPipeline) {
      const pipelineMsg: NormalizedMessage = {
        message_id: normalized.message.id,
        channel: "telegram",
        thread_id: normalized.thread.id,
        text: normalized.message.content.kind === "text"
          ? normalized.message.content.text
          : normalized.message.content.caption ?? "",
        sender: normalized.message.sender?.first_name,
        timestamp: normalized.message.timestamp,
      };

      const result = await deps.connectorPipeline.ingest(pipelineMsg);
      if (result === null) {
        // Duplicate or debounced — acknowledge without processing
        return c.json({ ok: true });
      }
    }

    // If no agent runtime, return normalized message (legacy behavior)
    if (!deps.agentRuntime || !deps.telegramBot) {
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

    try {
      const result = await deps.agentRuntime.turn({
        channel: "telegram",
        thread_id: chatId,
        message: messageText,
      });

      await deps.telegramBot.sendMessage(chatId, result.reply);
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
