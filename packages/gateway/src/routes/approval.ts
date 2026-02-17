/**
 * Approval queue REST routes.
 *
 * Provides endpoints for listing, viewing, and responding to pending
 * human approval requests.
 */

import { Hono } from "hono";
import type { ApprovalDal } from "../modules/approval/dal.js";

export function createApprovalRoutes(approvalDal: ApprovalDal): Hono {
  const app = new Hono();

  /** List approvals. Defaults to pending; use ?status= to filter. */
  app.get("/approvals", (c) => {
    const status = c.req.query("status");

    if (status === "pending" || status === undefined) {
      const approvals = approvalDal.getPending();
      return c.json({ approvals });
    }

    // For non-pending statuses, there's no dedicated query method,
    // so we return pending as the default list.
    const approvals = approvalDal.getPending();
    return c.json({ approvals });
  });

  /** Get a single approval by id. */
  app.get("/approvals/:id", (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json(
        { error: "invalid_request", message: "id must be a number" },
        400,
      );
    }

    const approval = approvalDal.getById(id);
    if (!approval) {
      return c.json(
        { error: "not_found", message: `approval ${String(id)} not found` },
        404,
      );
    }

    return c.json({ approval });
  });

  /** Respond to a pending approval (approve or deny). */
  app.post("/approvals/:id/respond", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json(
        { error: "invalid_request", message: "id must be a number" },
        400,
      );
    }

    const body = (await c.req.json()) as {
      approved?: boolean;
      reason?: string;
    };

    if (typeof body.approved !== "boolean") {
      return c.json(
        {
          error: "invalid_request",
          message: "approved (boolean) is required",
        },
        400,
      );
    }

    const updated = approvalDal.respond(id, body.approved, body.reason);
    if (!updated) {
      return c.json(
        {
          error: "not_found",
          message: `approval ${String(id)} not found or already responded`,
        },
        404,
      );
    }

    return c.json({ approval: updated });
  });

  /** Preview the context of a pending approval. */
  app.get("/approvals/:id/preview", (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json(
        { error: "invalid_request", message: "id must be a number" },
        400,
      );
    }

    const approval = approvalDal.getById(id);
    if (!approval) {
      return c.json(
        { error: "not_found", message: `approval ${String(id)} not found` },
        404,
      );
    }

    return c.json({
      id: approval.id,
      plan_id: approval.plan_id,
      step_index: approval.step_index,
      prompt: approval.prompt,
      context: approval.context,
      status: approval.status,
      expires_at: approval.expires_at,
    });
  });

  return app;
}
