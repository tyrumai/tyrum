/**
 * Node pairing REST routes.
 *
 * Provides endpoints for registering nodes, resolving pairing requests,
 * listing nodes, and revoking access.
 */

import { Hono } from "hono";
import type { NodeDal, PairingStatus } from "../modules/node/dal.js";

const VALID_STATUSES = new Set<PairingStatus>([
  "pending",
  "approved",
  "denied",
  "revoked",
]);

const VALID_DECISIONS = new Set(["approved", "denied", "revoked"]);

export interface NodeRouteDeps {
  nodeDal: NodeDal;
}

export function createNodeRoutes(deps: NodeRouteDeps): Hono {
  const app = new Hono();

  /** List nodes. Optional ?status= filter. */
  app.get("/nodes", async (c) => {
    const status = c.req.query("status") as PairingStatus | undefined;

    if (status && !VALID_STATUSES.has(status)) {
      return c.json(
        {
          error: "invalid_request",
          message: `Invalid status. Allowed: ${[...VALID_STATUSES].join(", ")}`,
        },
        400,
      );
    }

    const nodes = await deps.nodeDal.listNodes(status);
    return c.json({ nodes });
  });

  /** Get a single node by ID. */
  app.get("/nodes/:id", async (c) => {
    const id = c.req.param("id");
    const node = await deps.nodeDal.getById(id);

    if (!node) {
      return c.json(
        { error: "not_found", message: `node ${id} not found` },
        404,
      );
    }

    return c.json({ node });
  });

  /** Create a pairing request. */
  app.post("/nodes", async (c) => {
    const body = (await c.req.json()) as {
      node_id?: string;
      label?: string;
      capabilities?: string[];
      metadata?: unknown;
    };

    if (!body.node_id) {
      return c.json(
        { error: "invalid_request", message: "node_id is required" },
        400,
      );
    }

    const node = await deps.nodeDal.createPairingRequest(
      body.node_id,
      body.label,
      body.capabilities,
      body.metadata,
    );
    return c.json({ node }, 201);
  });

  /** Resolve a pairing request (approve, deny, or revoke). */
  app.post("/nodes/:id/pair", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json()) as {
      decision?: string;
      resolved_by?: string;
      reason?: string;
    };

    if (!body.decision || !VALID_DECISIONS.has(body.decision)) {
      return c.json(
        {
          error: "invalid_request",
          message: `decision is required. Allowed: ${[...VALID_DECISIONS].join(", ")}`,
        },
        400,
      );
    }

    const node = await deps.nodeDal.resolvePairing(
      id,
      body.decision as "approved" | "denied" | "revoked",
      body.resolved_by,
      body.reason,
    );

    if (!node) {
      return c.json(
        {
          error: "not_found",
          message: `node ${id} not found or not in pending state`,
        },
        404,
      );
    }

    return c.json({ node });
  });

  /** Revoke a node. */
  app.delete("/nodes/:id", async (c) => {
    const id = c.req.param("id");
    const node = await deps.nodeDal.revokeNode(id);

    if (!node) {
      return c.json(
        { error: "not_found", message: `node ${id} not found` },
        404,
      );
    }

    return c.json({ node });
  });

  return app;
}
