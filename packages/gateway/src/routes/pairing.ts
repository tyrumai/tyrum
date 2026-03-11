/**
 * Node pairing routes — durable allowlisting for node capability execution.
 */

import { Hono } from "hono";
import type { NodePairingDal } from "../modules/node/pairing-dal.js";
import type { Logger } from "../modules/observability/logger.js";
import type { WsEventDal } from "../modules/ws-event/dal.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";
import { resolveNodePairing } from "../modules/node/pairing-resolve-service.js";
import { emitPairingApprovedEvent } from "../ws/pairing-approved.js";
import { PAIRING_WS_AUDIENCE } from "../ws/audience.js";
import { broadcastWsEvent } from "../ws/broadcast.js";
import { CapabilityDescriptor, NodePairingTrustLevel, type WsEventEnvelope } from "@tyrum/schemas";
import { getClientIp } from "../modules/auth/client-ip.js";
import { requireTenantId } from "../modules/auth/claims.js";

export interface PairingRouteDeps {
  nodePairingDal: NodePairingDal;
  logger?: Logger;
  wsEventDal?: WsEventDal;
  ws?: {
    connectionManager: ConnectionManager;
    maxBufferedBytes?: number;
    cluster?: {
      edgeId: string;
      outboxDal: OutboxDal;
      connectionDirectory: ConnectionDirectoryDal;
    };
  };
}

function emitEvent(deps: PairingRouteDeps, tenantId: string, evt: WsEventEnvelope): void {
  const ws = deps.ws;
  if (!ws) return;
  broadcastWsEvent(tenantId, evt, { ...ws, logger: deps.logger }, PAIRING_WS_AUDIENCE);
}

export function createPairingRoutes(deps: PairingRouteDeps): Hono {
  const app = new Hono();

  app.get("/pairings", async (c) => {
    const tenantId = requireTenantId(c);
    const statusRaw = c.req.query("status")?.trim();
    const status =
      statusRaw === "pending" ||
      statusRaw === "approved" ||
      statusRaw === "denied" ||
      statusRaw === "revoked"
        ? statusRaw
        : undefined;
    const rows = await deps.nodePairingDal.list({ tenantId, status });
    return c.json({ status: "ok", pairings: rows });
  });

  app.post("/pairings/:id/approve", async (c) => {
    const tenantId = requireTenantId(c);
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "invalid_request", message: "id must be a positive integer" }, 400);
    }

    const body = (await c.req.json()) as Record<string, unknown>;
    const reason = typeof body["reason"] === "string" ? body["reason"] : undefined;

    const trustLevelRaw = body["trust_level"];
    if (trustLevelRaw === undefined) {
      return c.json({ error: "invalid_request", message: "trust_level is required" }, 400);
    }
    const trustLevelParsed = NodePairingTrustLevel.safeParse(trustLevelRaw);
    if (!trustLevelParsed.success) {
      return c.json(
        { error: "invalid_request", message: "trust_level must be 'local' or 'remote'" },
        400,
      );
    }

    const allowlistRaw = body["capability_allowlist"];
    if (allowlistRaw === undefined) {
      return c.json({ error: "invalid_request", message: "capability_allowlist is required" }, 400);
    }
    const allowlistParsed = CapabilityDescriptor.array().safeParse(allowlistRaw);
    if (!allowlistParsed.success) {
      return c.json(
        {
          error: "invalid_request",
          message: "capability_allowlist must be an array of CapabilityDescriptor",
        },
        400,
      );
    }

    const result = await resolveNodePairing(
      {
        nodePairingDal: deps.nodePairingDal,
        wsEventDal: deps.wsEventDal,
        emitEvent: ({ tenantId: eventTenantId, event }) => {
          emitEvent(deps, eventTenantId, event);
        },
        emitPairingApproved: deps.ws
          ? ({ tenantId: eventTenantId, pairing, nodeId, scopedToken }) => {
              emitPairingApprovedEvent({ ...deps.ws!, logger: deps.logger }, eventTenantId, {
                pairing,
                nodeId,
                scopedToken,
              });
            }
          : undefined,
      },
      {
        tenantId,
        pairingId: id,
        decision: "approved",
        reason,
        trustLevel: trustLevelParsed.data,
        capabilityAllowlist: allowlistParsed.data,
        resolvedBy: {
          kind: "http",
          ip: getClientIp(c),
          user_agent: c.req.header("user-agent") ?? undefined,
        },
      },
    );
    if (!result.ok) {
      return c.json(
        { error: result.code, message: result.message },
        result.code === "invalid_request" ? 400 : 404,
      );
    }

    return c.json({ status: "ok", pairing: result.pairing });
  });

  app.post("/pairings/:id/deny", async (c) => {
    const tenantId = requireTenantId(c);
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "invalid_request", message: "id must be a positive integer" }, 400);
    }
    const body = (await c.req.json()) as { reason?: string };

    const result = await resolveNodePairing(
      {
        nodePairingDal: deps.nodePairingDal,
        wsEventDal: deps.wsEventDal,
        emitEvent: ({ tenantId: eventTenantId, event }) => {
          emitEvent(deps, eventTenantId, event);
        },
      },
      {
        tenantId,
        pairingId: id,
        decision: "denied",
        reason: typeof body.reason === "string" ? body.reason : undefined,
        resolvedBy: {
          kind: "http",
          ip: getClientIp(c),
          user_agent: c.req.header("user-agent") ?? undefined,
        },
      },
    );
    if (!result.ok) {
      return c.json(
        { error: result.code, message: result.message },
        result.code === "invalid_request" ? 400 : 404,
      );
    }

    return c.json({ status: "ok", pairing: result.pairing });
  });

  app.post("/pairings/:id/revoke", async (c) => {
    const tenantId = requireTenantId(c);
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "invalid_request", message: "id must be a positive integer" }, 400);
    }
    const body = (await c.req.json()) as { reason?: string };

    const result = await resolveNodePairing(
      {
        nodePairingDal: deps.nodePairingDal,
        wsEventDal: deps.wsEventDal,
        emitEvent: ({ tenantId: eventTenantId, event }) => {
          emitEvent(deps, eventTenantId, event);
        },
      },
      {
        tenantId,
        pairingId: id,
        decision: "revoked",
        reason: typeof body.reason === "string" ? body.reason : undefined,
        resolvedBy: {
          kind: "http",
          ip: getClientIp(c),
          user_agent: c.req.header("user-agent") ?? undefined,
        },
      },
    );
    if (!result.ok) {
      return c.json(
        { error: result.code, message: result.message },
        result.code === "invalid_request" ? 400 : 404,
      );
    }

    return c.json({ status: "ok", pairing: result.pairing });
  });

  return app;
}
