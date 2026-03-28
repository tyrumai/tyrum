/**
 * Workflow routes — execution engine API entrypoints.
 */

import { WsWorkflowStartPayload } from "@tyrum/contracts";
import { Hono } from "hono";
import type { ExecutionEngine } from "../app/modules/execution/engine.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { AgentRegistry } from "../app/modules/agent/registry.js";
import type { IdentityScopeDal } from "../app/modules/identity/scope.js";
import { ScopeNotFoundError } from "../app/modules/identity/scope.js";
import { requireTenantId } from "../app/modules/auth/claims.js";
import { executeWorkflowStart } from "../app/modules/execution/workflow-start.js";

export interface WorkflowRouteDeps {
  engine: ExecutionEngine;
  policyService: PolicyService;
  agents?: AgentRegistry;
  identityScopeDal?: IdentityScopeDal;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function parseNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isInvalidRequestError(error: unknown): error is Error & { code: "invalid_request" } {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "invalid_request"
  );
}

export function createWorkflowRoutes(deps: WorkflowRouteDeps): Hono {
  const app = new Hono();

  app.post("/workflow/start", async (c) => {
    const tenantId = requireTenantId(c);
    const body = (await c.req.json()) as unknown;
    if (!isObject(body)) {
      return c.json({ error: "invalid_request", message: "body must be an object" }, 400);
    }

    const parsedBody = WsWorkflowStartPayload.safeParse(body);
    if (!parsedBody.success) {
      return c.json({ error: "invalid_request", message: parsedBody.error.message }, 400);
    }

    try {
      const result = await executeWorkflowStart(
        {
          engine: deps.engine,
          policyService: deps.policyService,
          agents: deps.agents,
          identityScopeDal: deps.identityScopeDal,
        },
        {
          tenantId,
          payload: parsedBody.data,
        },
      );

      return c.json({ status: "ok", ...result }, 200);
    } catch (error) {
      if (isInvalidRequestError(error)) {
        return c.json({ error: "invalid_request", message: error.message }, 400);
      }
      if (error instanceof ScopeNotFoundError) {
        return c.json({ error: error.code, message: error.message }, 404);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "internal_error", message }, 500);
    }
  });

  app.post("/workflow/resume", async (c) => {
    const body = (await c.req.json()) as unknown;
    if (!isObject(body)) {
      return c.json({ error: "invalid_request", message: "body must be an object" }, 400);
    }

    const token = parseNonEmptyString(body["token"]);
    if (!token) {
      return c.json({ error: "invalid_request", message: "token is required" }, 400);
    }

    const turnId = await deps.engine.resumeTurn(token);
    if (!turnId) {
      return c.json({ error: "not_found", message: "resume token not found" }, 404);
    }

    return c.json({ status: "ok", turn_id: turnId }, 200);
  });

  app.post("/workflow/cancel", async (c) => {
    const body = (await c.req.json()) as unknown;
    if (!isObject(body)) {
      return c.json({ error: "invalid_request", message: "body must be an object" }, 400);
    }

    const turnId = parseNonEmptyString(body["turn_id"]);
    if (!turnId) {
      return c.json({ error: "invalid_request", message: "turn_id is required" }, 400);
    }

    const reason = parseNonEmptyString(body["reason"]);
    const outcome = await deps.engine.cancelTurn(turnId, reason);
    if (outcome === "not_found") {
      return c.json({ error: "not_found", message: "turn not found" }, 404);
    }

    return c.json({ status: "ok", turn_id: turnId, cancelled: outcome === "cancelled" }, 200);
  });

  return app;
}
