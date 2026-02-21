/**
 * Approval queue REST routes.
 *
 * Provides endpoints for listing, viewing, and responding to pending
 * human approval requests.
 */

import { Hono } from "hono";
import type { ApprovalDal, ApprovalStatus } from "../modules/approval/dal.js";
import { resolveAndApplyApproval } from "../modules/approval/apply.js";
import type { ExecutionEngine } from "../modules/execution/engine.js";
import type { Logger } from "../modules/observability/logger.js";
import type { WsEventPublisher } from "../modules/approval/apply.js";

const VALID_STATUSES = new Set<ApprovalStatus>(["pending", "approved", "denied", "expired"]);

export function createApprovalRoutes(opts: {
  approvalDal: ApprovalDal;
  executionEngine?: Pick<ExecutionEngine, "resumeRun" | "cancelRunByResumeToken">;
  wsPublisher?: WsEventPublisher;
  logger?: Logger;
}): Hono {
  const app = new Hono();
  const approvalDal = opts.approvalDal;

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
      selected_override?: { tool_id: string; pattern: string };
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

    const decision = isApproved ? ("approved" as const) : ("denied" as const);
    const resolvedBy = {
      source: "http",
      user_agent: c.req.header("user-agent") ?? undefined,
    };
    const result = await resolveAndApplyApproval({
      approvalDal,
      executionEngine: opts.executionEngine,
      wsPublisher: opts.wsPublisher,
      logger: opts.logger,
      approvalId: id,
      decision,
      reason: body.reason,
      mode: body.mode,
      selectedOverride: body.selected_override,
      resolvedBy,
    });

    if (result.kind === "not_found") {
      return c.json({ error: "not_found", message: `approval ${String(id)} not found` }, 404);
    }

    if (result.kind === "pending") {
      return c.json(
        { error: "conflict", message: `approval ${String(id)} is still pending`, approval: result.approval },
        409,
      );
    }

    if (result.kind === "invalid_request") {
      return c.json({ error: "invalid_request", message: result.message }, 400);
    }

    if (result.kind === "conflict") {
      return c.json(
        {
          error: "conflict",
          message: `approval ${String(id)} already resolved as '${result.approval.status}'`,
          approval: result.approval,
        },
        409,
      );
    }

    return c.json({ approval: result.approval, applied: result.applied });
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
