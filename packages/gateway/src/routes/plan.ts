import { Hono } from "hono";
import { PlanRequest as PlanRequestSchema } from "@tyrum/contracts";
import type { PlanResponse } from "@tyrum/contracts";
import type { GatewayContainer } from "../container.js";
import { requireTenantId } from "../app/modules/auth/claims.js";
import { createGatewayPlanService } from "../app/modules/planner/service.js";

export function createPlanRoutes(container: GatewayContainer): Hono {
  const plan = new Hono();
  const planService = createGatewayPlanService(container);

  plan.post("/plan", async (c) => {
    const body: unknown = await c.req.json();
    const parsed = PlanRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const request = parsed.data;
    const tenantId = requireTenantId(c);

    if (request.request_id.trim() === "") {
      return c.json({ error: "invalid_request", message: "request_id must not be empty" }, 400);
    }

    const result = await planService.createPlan({ tenantId, request });
    const response: PlanResponse = {
      plan_id: result.planId,
      request_id: result.requestId,
      created_at: result.createdAt,
      trace_id: result.traceId,
      ...result.outcome,
    };
    return c.json(response);
  });

  return plan;
}
