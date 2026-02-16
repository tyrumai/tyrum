/**
 * Ingress routes — Telegram webhook normalization.
 */

import { Hono } from "hono";
import {
  normalizeUpdate,
  TelegramNormalizationError,
} from "../modules/ingress/telegram.js";

const ingress = new Hono();

ingress.post("/ingress/telegram", async (c) => {
  const rawBody = await c.req.text();

  if (!rawBody) {
    return c.json(
      { error: "invalid_request", message: "request body is empty" },
      400,
    );
  }

  try {
    const normalized = normalizeUpdate(rawBody);
    return c.json(normalized);
  } catch (err) {
    if (err instanceof TelegramNormalizationError) {
      return c.json(
        { error: "normalization_error", message: err.message },
        400,
      );
    }
    throw err;
  }
});

export { ingress };
