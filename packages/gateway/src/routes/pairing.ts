/**
 * Node pairing routes — durable allowlisting for node capability execution.
 */

import { resolveNodePairing } from "@tyrum/runtime-node-control";
import { Hono } from "hono";
import type { NodePairingDal } from "../app/modules/node/pairing-dal.js";
import type { Logger } from "../app/modules/observability/logger.js";
import type { WsEventDal } from "../app/modules/ws-event/dal.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { OutboxDal } from "../app/modules/backplane/outbox-dal.js";
import type { ConnectionDirectoryDal } from "../app/modules/backplane/connection-directory.js";
import { createResolveNodePairingDeps } from "../app/modules/node/runtime-node-control-adapters.js";
import { emitPairingApprovedEvent } from "../ws/pairing-approved.js";
import { PAIRING_WS_AUDIENCE } from "../ws/audience.js";
import { broadcastWsEvent } from "../ws/broadcast.js";
import {
  CapabilityDescriptor,
  NodePairingTrustLevel,
  type NodePairingRequest,
  type WsEventEnvelope,
} from "@tyrum/contracts";
import { getClientIp } from "../app/modules/auth/client-ip.js";
import { requireTenantId } from "../app/modules/auth/claims.js";
import type { DesktopEnvironmentDal } from "../app/modules/desktop-environments/dal.js";
import { enrichPairingsWithManagedDesktop as enrichManagedDesktopPairings } from "../app/modules/desktop-environments/managed-desktop-reference.js";

export interface PairingRouteDeps {
  nodePairingDal: NodePairingDal;
  desktopEnvironmentDal?: DesktopEnvironmentDal;
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

async function enrichPairingsWithManagedDesktop(
  deps: PairingRouteDeps,
  tenantId: string,
  pairings: readonly NodePairingRequest[],
): Promise<NodePairingRequest[]> {
  return await enrichManagedDesktopPairings({
    environmentDal: deps.desktopEnvironmentDal,
    tenantId,
    pairings,
  });
}

export function createPairingRoutes(deps: PairingRouteDeps): Hono {
  const app = new Hono();

  app.get("/pairings", async (c) => {
    const tenantId = requireTenantId(c);
    const statusRaw = c.req.query("status")?.trim();
    const status =
      statusRaw === "queued" ||
      statusRaw === "reviewing" ||
      statusRaw === "awaiting_human" ||
      statusRaw === "approved" ||
      statusRaw === "denied" ||
      statusRaw === "revoked"
        ? statusRaw
        : undefined;
    const rows = await deps.nodePairingDal.list({ tenantId, status });
    return c.json({
      status: "ok",
      pairings: await enrichPairingsWithManagedDesktop(deps, tenantId, rows),
    });
  });

  app.get("/pairings/:id", async (c) => {
    const tenantId = requireTenantId(c);
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "invalid_request", message: "id must be a positive integer" }, 400);
    }

    const pairing = await deps.nodePairingDal.getById(id, tenantId, true);
    if (!pairing) {
      return c.json({ error: "not_found", message: `pairing ${String(id)} not found` }, 404);
    }

    const [enriched] = await enrichPairingsWithManagedDesktop(deps, tenantId, [pairing]);
    return c.json({ status: "ok", pairing: enriched ?? pairing });
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
      createResolveNodePairingDeps({
        nodePairingDal: deps.nodePairingDal,
        desktopEnvironmentDal: deps.desktopEnvironmentDal,
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
        wsEventDal: deps.wsEventDal,
      }),
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

    const [enriched] = await enrichPairingsWithManagedDesktop(deps, tenantId, [result.pairing]);
    return c.json({ status: "ok", pairing: enriched ?? result.pairing });
  });

  app.post("/pairings/:id/deny", async (c) => {
    const tenantId = requireTenantId(c);
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "invalid_request", message: "id must be a positive integer" }, 400);
    }
    const body = (await c.req.json()) as { reason?: string };

    const result = await resolveNodePairing(
      createResolveNodePairingDeps({
        nodePairingDal: deps.nodePairingDal,
        desktopEnvironmentDal: deps.desktopEnvironmentDal,
        emitEvent: ({ tenantId: eventTenantId, event }) => {
          emitEvent(deps, eventTenantId, event);
        },
        wsEventDal: deps.wsEventDal,
      }),
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

    const [enriched] = await enrichPairingsWithManagedDesktop(deps, tenantId, [result.pairing]);
    return c.json({ status: "ok", pairing: enriched ?? result.pairing });
  });

  app.post("/pairings/:id/revoke", async (c) => {
    const tenantId = requireTenantId(c);
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "invalid_request", message: "id must be a positive integer" }, 400);
    }
    const body = (await c.req.json()) as { reason?: string };

    const result = await resolveNodePairing(
      createResolveNodePairingDeps({
        nodePairingDal: deps.nodePairingDal,
        desktopEnvironmentDal: deps.desktopEnvironmentDal,
        emitEvent: ({ tenantId: eventTenantId, event }) => {
          emitEvent(deps, eventTenantId, event);
        },
        wsEventDal: deps.wsEventDal,
      }),
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

    const [enriched] = await enrichPairingsWithManagedDesktop(deps, tenantId, [result.pairing]);
    return c.json({ status: "ok", pairing: enriched ?? result.pairing });
  });

  return app;
}
