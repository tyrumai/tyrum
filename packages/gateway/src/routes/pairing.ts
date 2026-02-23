/**
 * Node pairing routes — durable allowlisting for node capability execution.
 */

import { Hono } from "hono";
import type { NodePairingDal } from "../modules/node/pairing-dal.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import { CapabilityDescriptor, NodePairingTrustLevel, type WsEventEnvelope } from "@tyrum/schemas";

export interface PairingRouteDeps {
  nodePairingDal: NodePairingDal;
  ws?: {
    connectionManager: ConnectionManager;
    cluster?: {
      edgeId: string;
      outboxDal: OutboxDal;
    };
  };
}

function emitEvent(deps: PairingRouteDeps, evt: WsEventEnvelope): void {
  const ws = deps.ws;
  if (!ws) return;

  const payload = JSON.stringify(evt);
  for (const client of ws.connectionManager.allClients()) {
    try {
      client.ws.send(payload);
    } catch {
      // ignore
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

export function createPairingRoutes(deps: PairingRouteDeps): Hono {
  const app = new Hono();

  app.get("/pairings", async (c) => {
    const statusRaw = c.req.query("status")?.trim();
    const status =
      statusRaw === "pending" || statusRaw === "approved" || statusRaw === "denied" || statusRaw === "revoked"
        ? statusRaw
        : undefined;
    const rows = await deps.nodePairingDal.list({ status });
    return c.json({ status: "ok", pairings: rows });
  });

  app.post("/pairings/:id/approve", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "invalid_request", message: "id must be a positive integer" }, 400);
    }

    const body = (await c.req.json()) as Record<string, unknown>;
    const reason = typeof body["reason"] === "string" ? body["reason"] : undefined;

    const trustLevelRaw = body["trust_level"];
    const trustLevelParsed = trustLevelRaw === undefined ? undefined : NodePairingTrustLevel.safeParse(trustLevelRaw);
    if (trustLevelParsed && !trustLevelParsed.success) {
      return c.json({ error: "invalid_request", message: "trust_level must be 'local' or 'remote'" }, 400);
    }

    const allowlistRaw = body["capability_allowlist"];
    const allowlistParsed = allowlistRaw === undefined ? undefined : CapabilityDescriptor.array().safeParse(allowlistRaw);
    if (allowlistParsed && !allowlistParsed.success) {
      return c.json(
        { error: "invalid_request", message: "capability_allowlist must be an array of CapabilityDescriptor" },
        400,
      );
    }

    const pairing = await deps.nodePairingDal.resolve({
      pairingId: id,
      decision: "approved",
      reason,
      trustLevel: trustLevelParsed ? trustLevelParsed.data : undefined,
      capabilityAllowlist: allowlistParsed ? allowlistParsed.data : undefined,
      resolvedBy: {
        kind: "http",
        ip: c.req.header("x-forwarded-for") ?? undefined,
        user_agent: c.req.header("user-agent") ?? undefined,
      },
    });
    if (!pairing) {
      return c.json({ error: "not_found", message: "pairing not found or not pending" }, 404);
    }

    emitEvent(
      deps,
      {
        event_id: crypto.randomUUID(),
        type: "pairing.resolved",
        occurred_at: new Date().toISOString(),
        payload: { pairing },
      },
    );

    return c.json({ status: "ok", pairing });
  });

  app.post("/pairings/:id/deny", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "invalid_request", message: "id must be a positive integer" }, 400);
    }
    const body = (await c.req.json()) as { reason?: string };

    const pairing = await deps.nodePairingDal.resolve({
      pairingId: id,
      decision: "denied",
      reason: typeof body.reason === "string" ? body.reason : undefined,
      resolvedBy: {
        kind: "http",
        ip: c.req.header("x-forwarded-for") ?? undefined,
        user_agent: c.req.header("user-agent") ?? undefined,
      },
    });
    if (!pairing) {
      return c.json({ error: "not_found", message: "pairing not found or not pending" }, 404);
    }

    emitEvent(
      deps,
      {
        event_id: crypto.randomUUID(),
        type: "pairing.resolved",
        occurred_at: new Date().toISOString(),
        payload: { pairing },
      },
    );

    return c.json({ status: "ok", pairing });
  });

  app.post("/pairings/:id/revoke", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "invalid_request", message: "id must be a positive integer" }, 400);
    }
    const body = (await c.req.json()) as { reason?: string };

    const pairing = await deps.nodePairingDal.revoke({
      pairingId: id,
      reason: typeof body.reason === "string" ? body.reason : undefined,
      resolvedBy: {
        kind: "http",
        ip: c.req.header("x-forwarded-for") ?? undefined,
        user_agent: c.req.header("user-agent") ?? undefined,
      },
    });
    if (!pairing) {
      return c.json({ error: "not_found", message: "pairing not found or not approved" }, 404);
    }

    emitEvent(
      deps,
      {
        event_id: crypto.randomUUID(),
        type: "pairing.resolved",
        occurred_at: new Date().toISOString(),
        payload: { pairing },
      },
    );

    return c.json({ status: "ok", pairing });
  });

  return app;
}
