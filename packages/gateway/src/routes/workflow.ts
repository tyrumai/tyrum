/**
 * Workflow routes — execution engine API entrypoints.
 *
 * These are additive, feature-flagged surfaces to enqueue durable execution
 * runs without direct DB writes. They intentionally coexist with the legacy
 * plan runner while the execution engine is integrated incrementally.
 */

import { ActionPrimitive, ExecutionBudgets, parseTyrumKey } from "@tyrum/schemas";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { ExecutionEngine } from "../modules/execution/engine.js";
import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import type { ExecutionBudgets as ExecutionBudgetsT } from "@tyrum/schemas";
import type { PolicyService } from "../modules/policy/service.js";
import type { AgentRegistry } from "../modules/agent/registry.js";
import { requireTenantId } from "../modules/auth/claims.js";

export interface WorkflowRouteDeps {
  engine: ExecutionEngine;
  policyService: PolicyService;
  agents?: AgentRegistry;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function parseNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseSteps(value: unknown): ActionPrimitiveT[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const parsed: ActionPrimitiveT[] = [];
  for (const entry of value) {
    const step = ActionPrimitive.safeParse(entry);
    if (!step.success) return undefined;
    parsed.push(step.data);
  }
  return parsed;
}

function parseBudgets(value: unknown): ExecutionBudgetsT | undefined | null {
  if (typeof value === "undefined") return undefined;
  const parsed = ExecutionBudgets.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createWorkflowRoutes(deps: WorkflowRouteDeps): Hono {
  const app = new Hono();

  app.post("/workflow/run", async (c) => {
    const tenantId = requireTenantId(c);
    const body = (await c.req.json()) as unknown;
    if (!isObject(body)) {
      return c.json({ error: "invalid_request", message: "body must be an object" }, 400);
    }

    const key = parseNonEmptyString(body["key"]);
    if (!key) {
      return c.json({ error: "invalid_request", message: "key is required" }, 400);
    }

    const lane = parseNonEmptyString(body["lane"]) ?? "main";
    const planId = parseNonEmptyString(body["plan_id"]) ?? `plan-${randomUUID()}`;
    const requestId = parseNonEmptyString(body["request_id"]) ?? `req-${randomUUID()}`;
    const steps = parseSteps(body["steps"]);
    if (!steps) {
      return c.json(
        { error: "invalid_request", message: "steps must be a non-empty array of ActionPrimitive" },
        400,
      );
    }
    const budgetsParsed = parseBudgets(body["budgets"]);
    if (budgetsParsed === null) {
      return c.json({ error: "invalid_request", message: "budgets is invalid" }, 400);
    }
    const budgets = budgetsParsed;

    let agentId = "default";
    try {
      const parsedKey = parseTyrumKey(key as never);
      if (parsedKey.kind === "agent") {
        agentId = parsedKey.agent_key;
      }
    } catch (err) {
      void err;
      // ignore; treat as default agent
    }

    const policy = deps.agents ? deps.agents.getPolicyService(agentId) : deps.policyService;
    const effectivePolicy = await policy.loadEffectiveBundle({ tenantId });
    const snapshot = await policy.getOrCreateSnapshot(tenantId, effectivePolicy.bundle);

    const res = await deps.engine.enqueuePlan({
      tenantId,
      key,
      lane,
      planId,
      requestId,
      steps,
      policySnapshotId: snapshot.policy_snapshot_id,
      budgets,
    });

    return c.json(
      {
        status: "ok",
        job_id: res.jobId,
        run_id: res.runId,
        plan_id: planId,
        request_id: requestId,
        key,
        lane,
        steps_count: steps.length,
      },
      200,
    );
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

    const runId = await deps.engine.resumeRun(token);
    if (!runId) {
      return c.json({ error: "not_found", message: "resume token not found" }, 404);
    }

    return c.json({ status: "ok", run_id: runId }, 200);
  });

  app.post("/workflow/cancel", async (c) => {
    const body = (await c.req.json()) as unknown;
    if (!isObject(body)) {
      return c.json({ error: "invalid_request", message: "body must be an object" }, 400);
    }

    const runId = parseNonEmptyString(body["run_id"]);
    if (!runId) {
      return c.json({ error: "invalid_request", message: "run_id is required" }, 400);
    }

    const reason = parseNonEmptyString(body["reason"]);
    const outcome = await deps.engine.cancelRun(runId, reason);
    if (outcome === "not_found") {
      return c.json({ error: "not_found", message: "run not found" }, 404);
    }

    return c.json({ status: "ok", run_id: runId, cancelled: outcome === "cancelled" }, 200);
  });

  return app;
}
