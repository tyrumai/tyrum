/**
 * Routing config routes — operator surface for durable multi-agent routing rules.
 */

import { Hono } from "hono";
import { createHash, randomUUID } from "node:crypto";
import {
  RoutingConfigRevertRequest,
  RoutingConfigUpdateRequest,
  WsRoutingConfigUpdatedEvent,
  type WsEventEnvelope,
} from "@tyrum/schemas";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { RoutingConfigDal } from "../modules/channels/routing-config-dal.js";
import { getClientIp } from "../modules/auth/client-ip.js";

export interface RoutingConfigRouteDeps {
  routingConfigDal: RoutingConfigDal;
  ws?: {
    connectionManager: ConnectionManager;
    cluster?: {
      edgeId: string;
      outboxDal: OutboxDal;
    };
  };
}

function emitEvent(deps: RoutingConfigRouteDeps, evt: WsEventEnvelope): void {
  const ws = deps.ws;
  if (!ws) return;

  const payload = JSON.stringify(evt);
  for (const client of ws.connectionManager.allClients()) {
    try {
      client.ws.send(payload);
    } catch {
      // ignore best-effort sends
    }
  }

  if (ws.cluster) {
    void ws.cluster.outboxDal
      .enqueue("ws.broadcast", {
        source_edge_id: ws.cluster.edgeId,
        skip_local: true,
        message: evt,
      })
      .catch(() => {
        // ignore
      });
  }
}

export function createRoutingConfigRoutes(deps: RoutingConfigRouteDeps): Hono {
  const app = new Hono();

  app.get("/routing/config", async (c) => {
    const latest = await deps.routingConfigDal.getLatest();
    return c.json({
      revision: latest?.revision ?? 0,
      config: latest?.config ?? { v: 1 },
      created_at: latest?.createdAt ?? undefined,
      created_by: latest?.createdBy ?? undefined,
      reason: latest?.reason ?? undefined,
    });
  });

  app.put("/routing/config", async (c) => {
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
      config: parsed.data.config,
      reason: parsed.data.reason,
      createdBy,
    });

    const configSha256 = createHash("sha256")
      .update(JSON.stringify(persisted.config))
      .digest("hex");

    const candidate: WsEventEnvelope = {
      event_id: randomUUID(),
      type: "routing.config.updated",
      occurred_at: new Date().toISOString(),
      scope: { kind: "global" },
      payload: {
        revision: persisted.revision,
        reason: parsed.data.reason,
        config_sha256: configSha256,
        config: persisted.config,
      },
    };
    const evt = WsRoutingConfigUpdatedEvent.safeParse(candidate);
    if (evt.success) {
      emitEvent(deps, evt.data);
    }

    return c.json(
      {
        revision: persisted.revision,
        config: persisted.config,
        created_at: persisted.createdAt,
        created_by: persisted.createdBy,
        reason: persisted.reason,
      },
      201,
    );
  });

  app.post("/routing/config/revert", async (c) => {
    const body = (await c.req.json()) as unknown;
    const parsed = RoutingConfigRevertRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const target = await deps.routingConfigDal.getByRevision(parsed.data.revision);
    if (!target) {
      return c.json({ error: "not_found", message: "routing config revision not found" }, 404);
    }

    const createdBy = {
      kind: "http",
      ip: getClientIp(c),
      user_agent: c.req.header("user-agent") ?? undefined,
    };

    const persisted = await deps.routingConfigDal.set({
      config: target.config,
      reason: parsed.data.reason,
      createdBy,
    });

    const configSha256 = createHash("sha256")
      .update(JSON.stringify(persisted.config))
      .digest("hex");

    const candidate: WsEventEnvelope = {
      event_id: randomUUID(),
      type: "routing.config.updated",
      occurred_at: new Date().toISOString(),
      scope: { kind: "global" },
      payload: {
        revision: persisted.revision,
        reason: parsed.data.reason,
        config_sha256: configSha256,
        config: persisted.config,
        reverted_from_revision: parsed.data.revision,
      },
    };
    const evt = WsRoutingConfigUpdatedEvent.safeParse(candidate);
    if (evt.success) {
      emitEvent(deps, evt.data);
    }

    return c.json(
      {
        revision: persisted.revision,
        config: persisted.config,
        created_at: persisted.createdAt,
        created_by: persisted.createdBy,
        reason: persisted.reason,
        reverted_from_revision: parsed.data.revision,
      },
      201,
    );
  });

  return app;
}
