/**
 * Watcher CRUD routes.
 */

import { createHash, createHmac } from "node:crypto";
import { AgentKey, SecretHandle, WorkspaceId } from "@tyrum/contracts";
import type { SecretHandle as SecretHandleT } from "@tyrum/contracts";
import { Hono } from "hono";
import type { SecretProvider } from "../modules/secret/provider.js";
import { secureStringEqual } from "../utils/secure-string-equal.js";
import type { WatcherProcessor } from "../modules/watcher/processor.js";

const WEBHOOK_SIGNATURE_HEADER = "x-tyrum-webhook-signature";
const WEBHOOK_TIMESTAMP_HEADER = "x-tyrum-webhook-timestamp";
const WEBHOOK_NONCE_HEADER = "x-tyrum-webhook-nonce";
const DEFAULT_WEBHOOK_MAX_SKEW_MS = 5 * 60_000;
const MAX_WEBHOOK_MAX_SKEW_MS = 30 * 60_000;

interface WebhookEnvelope {
  signature: string;
  timestamp: string;
  nonce: string;
}

interface WebhookTriggerConfig {
  agent_key: string;
  secret_handle: SecretHandleT;
  max_skew_ms?: number;
}

export interface WatcherRouteDeps {
  secretProviderForTenant?: (tenantId: string) => SecretProvider;
}

function parseTimestampMs(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  // Accept UNIX seconds (10 digits) or milliseconds (13 digits).
  return value.length <= 10 ? parsed * 1000 : parsed;
}

function parseWebhookEnvelope(headers: {
  signature: string | undefined;
  timestamp: string | undefined;
  nonce: string | undefined;
}): WebhookEnvelope | null {
  const signature = headers.signature?.trim();
  const timestamp = headers.timestamp?.trim();
  const nonce = headers.nonce?.trim();

  if (!signature || !/^sha256=[A-Fa-f0-9]{64}$/.test(signature)) {
    return null;
  }
  if (!timestamp || !/^\d{10,13}$/.test(timestamp)) {
    return null;
  }
  if (!nonce || nonce.length > 256) {
    return null;
  }
  // Disallow '.' and other separators to keep the signed input unambiguous.
  // Base64url (and UUIDs) fit this constraint.
  if (!/^[A-Za-z0-9_-]+$/.test(nonce)) {
    return null;
  }

  return { signature, timestamp, nonce };
}

function parseWebhookTriggerConfig(raw: unknown): WebhookTriggerConfig | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const agentKeyRaw = (raw as Record<string, unknown>)["agent_key"];
  const agentKey = (() => {
    if (agentKeyRaw === undefined || agentKeyRaw === null) return "default";
    if (typeof agentKeyRaw !== "string") return null;
    const trimmed = agentKeyRaw.trim();
    if (!trimmed) return "default";
    if (trimmed === "default") return "default";
    const parsed = AgentKey.safeParse(trimmed);
    if (!parsed.success) return null;
    return parsed.data;
  })();
  if (!agentKey) {
    return null;
  }

  const secretHandleRaw = (raw as Record<string, unknown>)["secret_handle"];
  const parsedSecret = SecretHandle.safeParse(secretHandleRaw);
  if (!parsedSecret.success) {
    return null;
  }

  const maxSkewRaw = (raw as Record<string, unknown>)["max_skew_ms"];
  if (maxSkewRaw === undefined) {
    return { agent_key: agentKey, secret_handle: parsedSecret.data };
  }
  if (
    typeof maxSkewRaw !== "number" ||
    !Number.isInteger(maxSkewRaw) ||
    maxSkewRaw <= 0 ||
    maxSkewRaw > MAX_WEBHOOK_MAX_SKEW_MS
  ) {
    return null;
  }

  return {
    agent_key: agentKey,
    secret_handle: parsedSecret.data,
    max_skew_ms: maxSkewRaw,
  };
}

function computeWebhookSignature(
  secret: string,
  timestamp: string,
  nonce: string,
  body: string,
): string {
  const digest = createHmac("sha256", secret)
    .update(timestamp)
    .update(".")
    .update(nonce)
    .update(".")
    .update(body)
    .digest("hex");
  return `sha256=${digest}`;
}

export function createWatcherRoutes(
  processor: WatcherProcessor,
  deps: WatcherRouteDeps = {},
): Hono {
  const watcher = new Hono();

  watcher.post("/watchers", async (c) => {
    const body = (await c.req.json()) as {
      plan_id?: string;
      trigger_type?: string;
      trigger_config?: unknown;
    };

    if (!body.plan_id || !body.trigger_type) {
      return c.json(
        {
          error: "invalid_request",
          message: "plan_id and trigger_type are required",
        },
        400,
      );
    }

    const watcherId = await processor.createWatcher(
      body.plan_id,
      body.trigger_type,
      body.trigger_config ?? {},
    );

    return c.json(
      { watcher_id: watcherId, plan_id: body.plan_id, trigger_type: body.trigger_type },
      201,
    );
  });

  watcher.get("/watchers", async (c) => {
    const watchers = await processor.listWatchers();
    return c.json({ watchers });
  });

  watcher.patch("/watchers/:id", async (c) => {
    const watcherId = c.req.param("id")?.trim();
    const parsedWatcherId = WorkspaceId.safeParse(watcherId);
    if (!parsedWatcherId.success) {
      return c.json({ error: "invalid_request", message: "invalid watcher id" }, 400);
    }

    const body = (await c.req.json()) as { active?: boolean };
    if (body.active === false) {
      await processor.deactivateWatcher(parsedWatcherId.data);
    }

    return c.json({ watcher_id: parsedWatcherId.data, updated: true });
  });

  watcher.delete("/watchers/:id", async (c) => {
    const watcherId = c.req.param("id")?.trim();
    const parsedWatcherId = WorkspaceId.safeParse(watcherId);
    if (!parsedWatcherId.success) {
      return c.json({ error: "invalid_request", message: "invalid watcher id" }, 400);
    }

    await processor.deactivateWatcher(parsedWatcherId.data);
    return c.json({ watcher_id: parsedWatcherId.data, deleted: true });
  });

  watcher.post("/watchers/:id/trigger/webhook", async (c) => {
    const watcherId = c.req.param("id")?.trim();
    const parsedWatcherId = WorkspaceId.safeParse(watcherId);
    if (!parsedWatcherId.success) {
      return c.json({ error: "invalid_request", message: "invalid watcher id" }, 400);
    }

    const watcherRow = await processor.getActiveWatcherById(parsedWatcherId.data);
    if (!watcherRow || watcherRow.trigger_type !== "webhook") {
      return c.json({ error: "not_found", message: "webhook watcher not found" }, 404);
    }

    const envelope = parseWebhookEnvelope({
      signature: c.req.header(WEBHOOK_SIGNATURE_HEADER),
      timestamp: c.req.header(WEBHOOK_TIMESTAMP_HEADER),
      nonce: c.req.header(WEBHOOK_NONCE_HEADER),
    });
    if (!envelope) {
      return c.json(
        {
          error: "unauthorized",
          message: "missing or invalid webhook signature envelope",
        },
        401,
      );
    }

    const webhookConfig = parseWebhookTriggerConfig(watcherRow.trigger_config);
    if (!webhookConfig) {
      return c.json(
        {
          error: "misconfigured",
          message: "webhook trigger configuration is invalid",
        },
        503,
      );
    }

    if (!deps.secretProviderForTenant) {
      return c.json(
        {
          error: "misconfigured",
          message: "secret provider is not configured",
        },
        503,
      );
    }

    const timestampMs = parseTimestampMs(envelope.timestamp);
    if (timestampMs === null) {
      return c.json(
        {
          error: "unauthorized",
          message: "invalid webhook timestamp",
        },
        401,
      );
    }

    const maxSkewMs = webhookConfig.max_skew_ms ?? DEFAULT_WEBHOOK_MAX_SKEW_MS;
    if (Math.abs(Date.now() - timestampMs) > maxSkewMs) {
      return c.json(
        {
          error: "unauthorized",
          message: "webhook timestamp outside allowed replay window",
        },
        401,
      );
    }

    const secretProvider = deps.secretProviderForTenant(watcherRow.tenant_id);

    const secret = await secretProvider.resolve(webhookConfig.secret_handle);
    if (!secret || secret.trim().length === 0) {
      return c.json(
        {
          error: "unauthorized",
          message: "webhook secret not available",
        },
        401,
      );
    }

    const rawBody = await c.req.text();
    const expectedSignature = computeWebhookSignature(
      secret,
      envelope.timestamp,
      envelope.nonce,
      rawBody,
    );
    if (!secureStringEqual(envelope.signature.toLowerCase(), expectedSignature)) {
      return c.json(
        {
          error: "unauthorized",
          message: "invalid webhook signature",
        },
        401,
      );
    }

    const recorded = await processor.recordWebhookTrigger(watcherRow, {
      timestampMs,
      nonce: envelope.nonce,
      bodySha256: createHash("sha256").update(rawBody).digest("hex"),
      bodyBytes: Buffer.byteLength(rawBody),
    });
    if (!recorded) {
      return c.json(
        {
          error: "replay_detected",
          message: "webhook nonce has already been processed",
        },
        409,
      );
    }

    return c.json({ ok: true }, 202);
  });

  return watcher;
}
