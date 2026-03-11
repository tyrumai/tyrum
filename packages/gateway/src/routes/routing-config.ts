/**
 * Routing config routes — operator surface for durable multi-agent routing rules.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  RoutingConfigRevertRequest,
  RoutingConfigUpdateRequest,
  WsRoutingConfigUpdatedEvent,
  type WsEventEnvelope,
} from "@tyrum/schemas";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { RoutingConfigDal } from "../modules/channels/routing-config-dal.js";
import type { ChannelThreadDal } from "../modules/channels/thread-dal.js";
import type { Logger } from "../modules/observability/logger.js";
import { getClientIp } from "../modules/auth/client-ip.js";
import type { WsBroadcastAudience } from "../ws/audience.js";
import { broadcastWsEvent } from "../ws/broadcast.js";
import { requireTenantId } from "../modules/auth/claims.js";

export interface RoutingConfigRouteDeps {
  logger?: Logger;
  routingConfigDal: RoutingConfigDal;
  channelThreadDal: ChannelThreadDal;
  ws?: {
    connectionManager: ConnectionManager;
    maxBufferedBytes?: number;
    cluster?: {
      edgeId: string;
      outboxDal: OutboxDal;
    };
  };
}

const ROUTING_CONFIG_WS_AUDIENCE: WsBroadcastAudience = {
  roles: ["client"],
  required_scopes: ["operator.admin"],
};

function emitEvent(deps: RoutingConfigRouteDeps, tenantId: string, evt: WsEventEnvelope): void {
  const ws = deps.ws;
  if (!ws) return;
  broadcastWsEvent(tenantId, evt, { ...ws, logger: deps.logger }, ROUTING_CONFIG_WS_AUDIENCE);
}

function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw.trim())) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Number(raw)));
}

export function createRoutingConfigRoutes(deps: RoutingConfigRouteDeps): Hono {
  const app = new Hono();

  app.get("/routing/config", async (c) => {
    try {
      const tenantId = requireTenantId(c);
      const latest = await deps.routingConfigDal.getLatest(tenantId);
      return c.json({
        revision: latest?.revision ?? 0,
        config: latest?.config ?? { v: 1 },
        created_at: latest?.createdAt ?? undefined,
        created_by: latest?.createdBy ?? undefined,
        reason: latest?.reason ?? undefined,
        reverted_from_revision: latest?.revertedFromRevision ?? undefined,
      });
    } catch (err) {
      void err;
      return c.json(
        {
          error: "corrupt_state",
          message:
            "durable routing config state is invalid; write a new revision via PUT /routing/config to recover",
        },
        500,
      );
    }
  });

  app.put("/routing/config", async (c) => {
    const tenantId = requireTenantId(c);
    const body = (await c.req.json()) as unknown;
    const parsed = RoutingConfigUpdateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const createdBy = {
      kind: "http",
      ip: getClientIp(c),
      user_agent: c.req.header("user-agent") ?? undefined,
    };

    const persisted = await deps.routingConfigDal.set({
      tenantId,
      config: parsed.data.config,
      reason: parsed.data.reason,
      createdBy,
    });

    const candidate: WsEventEnvelope = {
      event_id: randomUUID(),
      type: "routing.config.updated",
      occurred_at: new Date().toISOString(),
      scope: { kind: "global" },
      payload: {
        revision: persisted.revision,
        reason: parsed.data.reason,
        config_sha256: persisted.configSha256,
      },
    };
    const evt = WsRoutingConfigUpdatedEvent.safeParse(candidate);
    if (evt.success) {
      emitEvent(deps, tenantId, evt.data);
    }

    return c.json(
      {
        revision: persisted.revision,
        config: persisted.config,
        created_at: persisted.createdAt,
        created_by: persisted.createdBy,
        reason: persisted.reason,
        reverted_from_revision: persisted.revertedFromRevision ?? undefined,
      },
      201,
    );
  });

  app.post("/routing/config/revert", async (c) => {
    const tenantId = requireTenantId(c);
    const body = (await c.req.json()) as unknown;
    const parsed = RoutingConfigRevertRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const target = await deps.routingConfigDal.getByRevision(tenantId, parsed.data.revision);
    if (!target) {
      return c.json({ error: "not_found", message: "routing config revision not found" }, 404);
    }

    const createdBy = {
      kind: "http",
      ip: getClientIp(c),
      user_agent: c.req.header("user-agent") ?? undefined,
    };

    const persisted = await deps.routingConfigDal.set({
      tenantId,
      config: target.config,
      reason: parsed.data.reason,
      createdBy,
      revertedFromRevision: parsed.data.revision,
    });

    const candidate: WsEventEnvelope = {
      event_id: randomUUID(),
      type: "routing.config.updated",
      occurred_at: new Date().toISOString(),
      scope: { kind: "global" },
      payload: {
        revision: persisted.revision,
        reason: parsed.data.reason,
        config_sha256: persisted.configSha256,
        reverted_from_revision: parsed.data.revision,
      },
    };
    const evt = WsRoutingConfigUpdatedEvent.safeParse(candidate);
    if (evt.success) {
      emitEvent(deps, tenantId, evt.data);
    }

    return c.json(
      {
        revision: persisted.revision,
        config: persisted.config,
        created_at: persisted.createdAt,
        created_by: persisted.createdBy,
        reason: persisted.reason,
        reverted_from_revision: persisted.revertedFromRevision ?? parsed.data.revision,
      },
      201,
    );
  });

  app.get("/routing/config/revisions", async (c) => {
    const tenantId = requireTenantId(c);
    const limit = parseLimit(c.req.query("limit"), 20, 100);
    const revisions = await deps.routingConfigDal.listRevisions({ tenantId, limit });
    return c.json(
      {
        revisions: revisions.map((revision) => ({
          revision: revision.revision,
          config: revision.config,
          created_at: revision.createdAt,
          created_by: revision.createdBy,
          reason: revision.reason ?? undefined,
          reverted_from_revision: revision.revertedFromRevision ?? undefined,
        })),
      },
      200,
    );
  });

  app.get("/routing/channels/telegram/threads", async (c) => {
    const tenantId = requireTenantId(c);
    const limit = parseLimit(c.req.query("limit"), 200, 200);
    const threads = await deps.channelThreadDal.listObservedThreads({
      tenantId,
      connectorKey: "telegram",
      limit,
    });
    return c.json(
      {
        threads: threads.map((thread) => ({
          channel: "telegram",
          account_key: thread.accountKey,
          thread_id: thread.threadId,
          container_kind: thread.containerKind,
          session_title: thread.sessionTitle,
          last_active_at: thread.lastActiveAt,
        })),
      },
      200,
    );
  });

  return app;
}
