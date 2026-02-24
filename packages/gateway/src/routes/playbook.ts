/**
 * Playbook routes — list, detail, and run loaded playbooks.
 */

import { Hono } from "hono";
import { ExecutionBudgets, PolicyBundle, PlaybookRuntimeRequest } from "@tyrum/schemas";
import type { Playbook } from "@tyrum/schemas";
import type { ExecutionBudgets as ExecutionBudgetsT } from "@tyrum/schemas";
import { PlaybookRunner } from "../modules/playbook/runner.js";
import { runPlaybookRuntimeEnvelope } from "../modules/playbook/runtime.js";
import { randomUUID } from "node:crypto";
import type { ExecutionEngine } from "../modules/execution/engine.js";
import type { PolicyService } from "../modules/policy/service.js";
import type { ApprovalDal } from "../modules/approval/dal.js";
import type { SqlDb } from "../statestore/types.js";

export interface PlaybookRouteDeps {
  playbooks: Playbook[];
  runner: PlaybookRunner;
  engine?: ExecutionEngine;
  policyService?: PolicyService;
  approvalDal?: ApprovalDal;
  db?: SqlDb;
}

export function createPlaybookRoutes(deps: PlaybookRouteDeps): Hono {
  const app = new Hono();

  app.get("/playbooks", (c) => {
    const items = deps.playbooks.map((pb) => ({
      id: pb.manifest.id,
      name: pb.manifest.name,
      description: pb.manifest.description ?? null,
      version: pb.manifest.version,
      step_count: pb.manifest.steps.length,
      file_path: pb.file_path,
      loaded_at: pb.loaded_at,
    }));
    return c.json({ playbooks: items });
  });

  app.get("/playbooks/:id", (c) => {
    const id = c.req.param("id");
    const pb = deps.playbooks.find((p) => p.manifest.id === id);
    if (!pb) {
      return c.json({ error: "not_found", message: `Playbook '${id}' not found` }, 404);
    }
    return c.json(pb);
  });

  app.post("/playbooks/:id/run", (c) => {
    const id = c.req.param("id");
    const pb = deps.playbooks.find((p) => p.manifest.id === id);
    if (!pb) {
      return c.json({ error: "not_found", message: `Playbook '${id}' not found` }, 404);
    }

    const result = deps.runner.run(pb);
    return c.json(result);
  });

  /**
   * Playbook runtime envelope contract (run / resume).
   *
   * See: docs/architecture/playbooks.md
   */
  app.post("/playbooks/runtime", async (c) => {
    if (!deps.engine || !deps.policyService || !deps.approvalDal || !deps.db) {
      return c.json(
        { error: "unsupported", message: "playbook runtime is not available (execution engine not configured)" },
        400,
      );
    }

    const body = (await c.req.json().catch(() => undefined)) as unknown;
    const parsed = PlaybookRuntimeRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const input = parsed.data;
    const envelope = await runPlaybookRuntimeEnvelope(
      {
        db: deps.db,
        engine: deps.engine,
        policyService: deps.policyService,
        approvalDal: deps.approvalDal,
        playbooks: deps.playbooks,
        runner: deps.runner,
      },
      input.action === "run"
        ? { action: "run", pipeline: input.pipeline, timeoutMs: input.timeoutMs }
        : {
            action: "resume",
            token: input.token,
            approve: input.approve,
            reason: input.reason,
            timeoutMs: input.timeoutMs,
          },
    );

    return c.json(envelope, 200);
  });

  /**
   * Execute a playbook durably via the execution engine.
   *
   * This is feature-gated by `TYRUM_ENGINE_API_ENABLED`, since the engine
   * instance is only wired when enabled in `createApp(...)`.
   */
  app.post("/playbooks/:id/execute", async (c) => {
    if (!deps.engine || !deps.policyService) {
      return c.json({ error: "unsupported", message: "execution engine API is not enabled" }, 400);
    }

    const id = c.req.param("id");
    const pb = deps.playbooks.find((p) => p.manifest.id === id);
    if (!pb) {
      return c.json({ error: "not_found", message: `Playbook '${id}' not found` }, 404);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const key = typeof body["key"] === "string" && body["key"].trim().length > 0 ? body["key"].trim() : pb.manifest.id;
    const lane = typeof body["lane"] === "string" && body["lane"].trim().length > 0 ? body["lane"].trim() : "main";
    const planId =
      typeof body["plan_id"] === "string" && body["plan_id"].trim().length > 0
        ? body["plan_id"].trim()
        : `playbook-${pb.manifest.id}-${randomUUID()}`;
    const requestId =
      typeof body["request_id"] === "string" && body["request_id"].trim().length > 0
        ? body["request_id"].trim()
        : `req-${randomUUID()}`;
    let budgets: ExecutionBudgetsT | undefined;
    if (Object.prototype.hasOwnProperty.call(body, "budgets")) {
      const parsed = ExecutionBudgets.safeParse(body["budgets"]);
      if (!parsed.success) {
        return c.json({ error: "invalid_request", message: "budgets is invalid" }, 400);
      }
      budgets = parsed.data;
    }

    const compiled = deps.runner.run(pb);
    const steps = compiled.steps;

    const playbookBundle =
      pb.manifest.allowed_domains && pb.manifest.allowed_domains.length > 0
        ? PolicyBundle.parse({
            v: 1,
            network_egress: {
              default: "require_approval",
              allow: pb.manifest.allowed_domains.flatMap((d) => [`https://${d}/*`, `http://${d}/*`]),
              require_approval: [],
              deny: [],
            },
          })
        : undefined;

    const effectivePolicy = await deps.policyService.loadEffectiveBundle({
      playbookBundle,
    });
    const snapshot = await deps.policyService.getOrCreateSnapshot(effectivePolicy.bundle);

    const res = await deps.engine.enqueuePlan({
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
        playbook_id: pb.manifest.id,
        plan_id: planId,
        request_id: requestId,
        key,
        lane,
        steps_count: steps.length,
      },
      200,
    );
  });

  return app;
}
