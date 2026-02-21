/**
 * Workflow execution routes -- HTTP API for the durable execution engine.
 */

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import type { SqlDb } from "../statestore/types.js";
import type { EventPublisher } from "../modules/backplane/event-publisher.js";
import type { ExecutionEngine } from "../modules/execution/engine.js";

export interface WorkflowRouteDeps {
  db: SqlDb;
  eventPublisher?: EventPublisher;
  engine?: ExecutionEngine;
}

export function createWorkflowRoutes(deps: WorkflowRouteDeps): Hono {
  const app = new Hono();

  // POST /workflow/run -- enqueue a new workflow run
  app.post("/workflow/run", async (c) => {
    const body = (await c.req.json()) as {
      key?: string;
      lane?: string;
      steps?: unknown[];
      trigger?: unknown;
      idempotency_key?: string;
      budget_tokens?: number;
      queue_mode?: string;
    };

    if (
      !body.key ||
      !body.steps ||
      !Array.isArray(body.steps) ||
      body.steps.length === 0
    ) {
      return c.json(
        {
          error: "invalid_request",
          message: "key and non-empty steps array are required",
        },
        400,
      );
    }

    const requestId = c.req.header("x-request-id") ?? randomUUID();
    const jobId = randomUUID();
    const runId = randomUUID();
    const lane = body.lane ?? "main";
    const budgetTokens = typeof body.budget_tokens === "number" && body.budget_tokens > 0
      ? body.budget_tokens
      : null;
    const queueMode = body.queue_mode ?? "collect";

    const trigger = body.trigger ?? {
      kind: "api",
      metadata: {
        plan_id: body.idempotency_key ?? jobId,
        request_id: requestId,
      },
    };
    const triggerJson = JSON.stringify(trigger);
    const inputJson = JSON.stringify({
      plan_id: body.idempotency_key ?? jobId,
      request_id: requestId,
    });

    try {
      await deps.db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id)
           VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
          [jobId, body.key, lane, triggerJson, inputJson, runId],
        );

        await tx.run(
          `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt, budget_tokens, queue_mode)
           VALUES (?, ?, ?, ?, 'queued', 1, ?, ?)`,
          [runId, jobId, body.key, lane, budgetTokens, queueMode],
        );

        for (let i = 0; i < body.steps!.length; i++) {
          const stepId = randomUUID();
          const step = body.steps![i] as Record<string, unknown> | undefined;
          const rollbackHint = step && typeof step["rollback_hint"] === "string"
            ? step["rollback_hint"]
            : null;
          await tx.run(
            `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json, max_attempts, timeout_ms, rollback_hint)
             VALUES (?, ?, ?, 'queued', ?, 3, 30000, ?)`,
            [stepId, runId, i, JSON.stringify(step), rollbackHint],
          );
        }

        await tx.run(
          `UPDATE execution_jobs SET status = 'running' WHERE job_id = ?`,
          [jobId],
        );
      });

      if (deps.eventPublisher) {
        await deps.eventPublisher.publish("run.queued", {
          run_id: runId,
          status: "queued",
        });
      }

      return c.json({ job_id: jobId, run_id: runId }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "enqueue_failed", message }, 500);
    }
  });

  // POST /workflow/resume -- resume a paused run
  app.post("/workflow/resume", async (c) => {
    const body = (await c.req.json()) as {
      run_id?: string;
      resume_token?: string;
    };

    if (!body.run_id || !body.resume_token) {
      return c.json(
        {
          error: "invalid_request",
          message: "run_id and resume_token are required",
        },
        400,
      );
    }

    try {
      const token = await deps.db.get<{
        token: string;
        run_id: string;
        expires_at: string | null;
        revoked_at: string | null;
      }>(
        "SELECT token, run_id, expires_at, revoked_at FROM resume_tokens WHERE token = ? AND run_id = ?",
        [body.resume_token, body.run_id],
      );

      if (!token) {
        return c.json(
          { error: "invalid_token", message: "resume token not found" },
          404,
        );
      }

      if (token.revoked_at !== null) {
        return c.json(
          { error: "token_revoked", message: "resume token already used" },
          409,
        );
      }

      if (token.expires_at !== null) {
        const expiresAtMs = new Date(token.expires_at).getTime();
        if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
          return c.json(
            { error: "token_expired", message: "resume token has expired" },
            410,
          );
        }
      }

      const nowIso = new Date().toISOString();

      await deps.db.transaction(async (tx) => {
        await tx.run(
          "UPDATE resume_tokens SET revoked_at = ? WHERE token = ?",
          [nowIso, body.resume_token],
        );
        await tx.run(
          "UPDATE execution_runs SET status = 'queued', paused_reason = NULL, paused_detail = NULL WHERE run_id = ? AND status = 'paused'",
          [body.run_id],
        );
        await tx.run(
          "UPDATE execution_steps SET status = 'queued' WHERE run_id = ? AND status = 'paused'",
          [body.run_id],
        );
      });

      if (deps.eventPublisher) {
        await deps.eventPublisher.publish("run.started", {
          run_id: body.run_id,
          status: "queued",
        });
      }

      return c.json({ resumed: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "resume_failed", message }, 500);
    }
  });

  // POST /workflow/cancel -- cancel a run
  app.post("/workflow/cancel", async (c) => {
    const body = (await c.req.json()) as {
      run_id?: string;
      reason?: string;
    };

    if (!body.run_id) {
      return c.json(
        { error: "invalid_request", message: "run_id is required" },
        400,
      );
    }

    // Use engine.cancelRun() if available (signals in-flight steps).
    if (deps.engine) {
      const cancelled = await deps.engine.cancelRun(body.run_id);
      if (!cancelled) {
        return c.json(
          { error: "not_found", message: "run not found or already finished" },
          404,
        );
      }
    } else {
      const nowIso = new Date().toISOString();
      const result = await deps.db.run(
        "UPDATE execution_runs SET status = 'cancelled', finished_at = ? WHERE run_id = ? AND status IN ('queued', 'running', 'paused')",
        [nowIso, body.run_id],
      );

      if ((result.changes ?? 0) === 0) {
        return c.json(
          { error: "not_found", message: "run not found or already finished" },
          404,
        );
      }

      await deps.db.run(
        "UPDATE execution_steps SET status = 'cancelled' WHERE run_id = ? AND status IN ('queued', 'running', 'paused')",
        [body.run_id],
      );
    }

    if (deps.eventPublisher) {
      await deps.eventPublisher.publish("run.cancelled", {
        run_id: body.run_id,
        status: "cancelled",
        detail: body.reason,
      });
    }

    return c.json({ cancelled: true });
  });

  // GET /workflow/runs -- list runs
  app.get("/workflow/runs", async (c) => {
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const status = c.req.query("status");

    let query =
      "SELECT run_id, job_id, key, lane, status, attempt, created_at, started_at, finished_at FROM execution_runs";
    const params: unknown[] = [];

    if (status) {
      query += " WHERE status = ?";
      params.push(status);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(Math.min(limit, 200));

    const rows = await deps.db.all<{
      run_id: string;
      job_id: string;
      key: string;
      lane: string;
      status: string;
      attempt: number;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
    }>(query, params);

    return c.json({ runs: rows });
  });

  // GET /workflow/runs/:id -- run detail with steps
  app.get("/workflow/runs/:id", async (c) => {
    const runId = c.req.param("id");

    const run = await deps.db.get<{
      run_id: string;
      job_id: string;
      key: string;
      lane: string;
      status: string;
      attempt: number;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
    }>(
      "SELECT run_id, job_id, key, lane, status, attempt, created_at, started_at, finished_at FROM execution_runs WHERE run_id = ?",
      [runId],
    );

    if (!run) {
      return c.json({ error: "not_found", message: "run not found" }, 404);
    }

    const steps = await deps.db.all<{
      step_id: string;
      step_index: number;
      status: string;
      action_json: string;
      created_at: string;
    }>(
      "SELECT step_id, step_index, status, action_json, created_at FROM execution_steps WHERE run_id = ? ORDER BY step_index ASC",
      [runId],
    );

    return c.json({
      run,
      steps: steps.map((s) => ({
        ...s,
        action: (() => {
          try {
            return JSON.parse(s.action_json) as unknown;
          } catch {
            return null;
          }
        })(),
      })),
    });
  });

  return app;
}
