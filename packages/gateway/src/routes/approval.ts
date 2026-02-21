/**
 * Approval queue REST routes.
 *
 * Provides endpoints for listing, viewing, and responding to pending
 * human approval requests.
 */

import { Hono } from "hono";
import type { ApprovalDal, ApprovalStatus } from "../modules/approval/dal.js";
import type { EventBus } from "../event-bus.js";
import type { PolicyOverrideDal } from "../modules/policy/override-dal.js";

const VALID_STATUSES = new Set<ApprovalStatus>(["pending", "approved", "denied", "expired"]);

export interface ApprovalRouteDeps {
  approvalDal: ApprovalDal;
  eventBus?: EventBus;
  policyOverrideDal?: PolicyOverrideDal;
}

export function createApprovalRoutes(deps: ApprovalRouteDeps): Hono {
  const { approvalDal, eventBus } = deps;
  const app = new Hono();

  /** List approvals. Defaults to pending; use ?status= to filter. */
  app.get("/approvals", async (c) => {
    const status = c.req.query("status") as ApprovalStatus | undefined;

    if (status && !VALID_STATUSES.has(status)) {
      return c.json(
        {
          error: "invalid_request",
          message: `Invalid status. Allowed: ${[...VALID_STATUSES].join(", ")}`,
        },
        400,
      );
    }

    const approvals = await approvalDal.getByStatus(status ?? "pending");
    return c.json({ approvals });
  });

  /** Get a single approval by id. */
  app.get("/approvals/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json(
        { error: "invalid_request", message: "id must be a number" },
        400,
      );
    }

    const approval = await approvalDal.getById(id);
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
      decision?: "approved" | "denied";
      approved?: boolean;
      reason?: string;
      mode?: "once" | "always";
      agent_id?: string;
      tool_id?: string;
      pattern?: string;
    };

    // Accept either { decision: "approved"|"denied" } or legacy { approved: boolean }
    let isApproved: boolean;
    if (body.decision === "approved" || body.decision === "denied") {
      isApproved = body.decision === "approved";
    } else if (typeof body.approved === "boolean") {
      isApproved = body.approved;
    } else {
      return c.json(
        {
          error: "invalid_request",
          message:
            'decision ("approved" or "denied") or approved (boolean) is required',
        },
        400,
      );
    }

    const updated = await approvalDal.respond(id, isApproved, body.reason);
    if (!updated) {
      return c.json(
        {
          error: "not_found",
          message: `approval ${String(id)} not found or already responded`,
        },
        404,
      );
    }

    // If approved with mode "always", create a standing policy override.
    if (isApproved && body.mode === "always" && deps.policyOverrideDal && body.agent_id && body.tool_id && body.pattern) {
      await deps.policyOverrideDal.create({
        agentId: body.agent_id,
        toolId: body.tool_id,
        pattern: body.pattern,
        approvalId: id,
      });
    }

    eventBus?.emit("approval:resolved", {
      approvalId: id,
      approved: isApproved,
      reason: body.reason,
    });

    return c.json({ approval: updated });
  });

  /** Preview the context of a pending approval. */
  app.get("/approvals/:id/preview", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) {
      return c.json(
        { error: "invalid_request", message: "id must be a number" },
        400,
      );
    }

    const approval = await approvalDal.getById(id);
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
