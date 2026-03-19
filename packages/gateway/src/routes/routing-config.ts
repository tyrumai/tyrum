/**
 * Routing config routes — legacy read-only compatibility surface.
 */

import { Hono } from "hono";
import { ChannelConfigListResponse } from "@tyrum/contracts";
import type { SqlDb } from "../statestore/types.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import { ChannelConfigDal, toChannelConfigView } from "../modules/channels/channel-config-dal.js";
import type { RoutingConfigDal } from "../modules/channels/routing-config-dal.js";
import type { ChannelThreadDal } from "../modules/channels/thread-dal.js";
import type { Logger } from "../modules/observability/logger.js";
import { requireTenantId } from "../modules/auth/claims.js";

export interface RoutingConfigRouteDeps {
  db: SqlDb;
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

function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw.trim())) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Number(raw)));
}

function readOnlyCompatibilityResponse() {
  return {
    error: "unsupported_operation" as const,
    message: "legacy routing config is read-only; use /config/channels instead",
  };
}

export function createRoutingConfigRoutes(deps: RoutingConfigRouteDeps): Hono {
  const app = new Hono();
  const channelConfigDal = new ChannelConfigDal(deps.db);

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
          message: "durable routing config state is invalid; legacy routing data could not be read",
        },
        500,
      );
    }
  });

  app.put("/routing/config", async (c) => {
    requireTenantId(c);
    return c.json(readOnlyCompatibilityResponse(), 405);
  });

  app.post("/routing/config/revert", async (c) => {
    requireTenantId(c);
    return c.json(readOnlyCompatibilityResponse(), 405);
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

  app.get("/routing/channels/configs", async (c) => {
    const tenantId = requireTenantId(c);
    const channels = await channelConfigDal.listTelegram(tenantId);
    return c.json(
      ChannelConfigListResponse.parse({
        channels: channels.map((config) => toChannelConfigView(config)),
      }),
      200,
    );
  });

  app.post("/routing/channels/configs", async (c) => {
    requireTenantId(c);
    return c.json(readOnlyCompatibilityResponse(), 405);
  });

  app.patch("/routing/channels/configs/:channel/:accountKey", async (c) => {
    requireTenantId(c);
    return c.json(readOnlyCompatibilityResponse(), 405);
  });

  app.delete("/routing/channels/configs/:channel/:accountKey", async (c) => {
    requireTenantId(c);
    return c.json(readOnlyCompatibilityResponse(), 405);
  });

  return app;
}
