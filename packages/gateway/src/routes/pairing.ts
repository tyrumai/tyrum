/**
 * Node pairing routes — durable allowlisting for node capability execution.
 */

import { Hono } from "hono";
import type { NodePairingDal } from "../modules/node/pairing-dal.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { ConnectionDirectoryDal } from "../modules/backplane/connection-directory.js";
import { CapabilityDescriptor, NodePairingTrustLevel, type WsEventEnvelope } from "@tyrum/schemas";

export interface PairingRouteDeps {
  nodePairingDal: NodePairingDal;
  ws?: {
    connectionManager: ConnectionManager;
    cluster?: {
      edgeId: string;
      outboxDal: OutboxDal;
      connectionDirectory: ConnectionDirectoryDal;
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

function emitPairingApprovedEvent(
  deps: PairingRouteDeps,
  input: { pairing: unknown; nodeId: string; scopedToken: string },
): void {
  const ws = deps.ws;
  if (!ws) return;

  const evt = {
    event_id: crypto.randomUUID(),
    type: "pairing.approved",
    occurred_at: new Date().toISOString(),
    payload: { pairing: input.pairing, scoped_token: input.scopedToken },
  } satisfies WsEventEnvelope;

  // Local, direct (do not broadcast tokens).
  const payload = JSON.stringify(evt);
  for (const client of ws.connectionManager.allClients()) {
    if (client.role !== "node") continue;
    if (client.device_id !== input.nodeId) continue;
    try {
      client.ws.send(payload);
    } catch {
      // ignore
    }
  }

  // Cluster, direct (best-effort).
  if (ws.cluster) {
    const cluster = ws.cluster;
    void (async () => {
      const nowMs = Date.now();
      const peers = await cluster.connectionDirectory.listNonExpired(nowMs);
      for (const peer of peers) {
        if (peer.role !== "node") continue;
        if (peer.device_id !== input.nodeId) continue;
        if (peer.edge_id === cluster.edgeId) continue;
        await cluster.outboxDal.enqueue(
          "ws.direct",
          { connection_id: peer.connection_id, message: evt },
          { targetEdgeId: peer.edge_id },
        );
      }
    })().catch(() => {
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
    if (trustLevelRaw === undefined) {
      return c.json({ error: "invalid_request", message: "trust_level is required" }, 400);
    }
    const trustLevelParsed = NodePairingTrustLevel.safeParse(trustLevelRaw);
    if (!trustLevelParsed.success) {
      return c.json({ error: "invalid_request", message: "trust_level must be 'local' or 'remote'" }, 400);
    }

    const allowlistRaw = body["capability_allowlist"];
    if (allowlistRaw === undefined) {
      return c.json({ error: "invalid_request", message: "capability_allowlist is required" }, 400);
    }
    const allowlistParsed = CapabilityDescriptor.array().safeParse(allowlistRaw);
    if (!allowlistParsed.success) {
      return c.json(
        { error: "invalid_request", message: "capability_allowlist must be an array of CapabilityDescriptor" },
        400,
      );
    }

    const resolved = await deps.nodePairingDal.resolve({
      pairingId: id,
      decision: "approved",
      reason,
      trustLevel: trustLevelParsed.data,
      capabilityAllowlist: allowlistParsed.data,
      resolvedBy: {
        kind: "http",
        ip: c.req.header("x-forwarded-for") ?? undefined,
        user_agent: c.req.header("user-agent") ?? undefined,
      },
    });
    if (!resolved) {
      return c.json({ error: "not_found", message: "pairing not found or not pending" }, 404);
    }
    const { pairing, scopedToken } = resolved;

    if (scopedToken) {
      emitPairingApprovedEvent(deps, { pairing, nodeId: pairing.node.node_id, scopedToken });
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

    return c.json({ status: "ok", pairing, scoped_token: scopedToken });
  });

  app.post("/pairings/:id/deny", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "invalid_request", message: "id must be a positive integer" }, 400);
    }
    const body = (await c.req.json()) as { reason?: string };

    const resolved = await deps.nodePairingDal.resolve({
      pairingId: id,
      decision: "denied",
      reason: typeof body.reason === "string" ? body.reason : undefined,
      resolvedBy: {
        kind: "http",
        ip: c.req.header("x-forwarded-for") ?? undefined,
        user_agent: c.req.header("user-agent") ?? undefined,
      },
    });
    if (!resolved) {
      return c.json({ error: "not_found", message: "pairing not found or not pending" }, 404);
    }
    const { pairing } = resolved;

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
