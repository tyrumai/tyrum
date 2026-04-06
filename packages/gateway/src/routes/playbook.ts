/**
 * Playbook routes — list, detail, and run loaded playbooks.
 */

import { Hono } from "hono";
import { ExecutionBudgets, parseTyrumKey, PlaybookRuntimeRequest } from "@tyrum/contracts";
import type { Playbook } from "@tyrum/contracts";
import type { ExecutionBudgets as ExecutionBudgetsT } from "@tyrum/contracts";
import { PlaybookRunner } from "../app/modules/playbook/runner.js";
import {
  resolvePlaybookPolicyBundle,
  runPlaybookRuntimeEnvelope,
} from "../app/modules/playbook/runtime.js";
import { randomUUID } from "node:crypto";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { ApprovalDal } from "../app/modules/approval/dal.js";
import type { SqlDb } from "../statestore/types.js";
import { requireTenantId } from "../app/modules/auth/claims.js";
import type { IdentityScopeDal } from "../app/modules/identity/scope.js";
import { createQueuedWorkflowRunFromActions } from "../app/modules/workflow-run/create-queued-run.js";

export interface PlaybookRouteDeps {
  playbooks: Playbook[];
  runner: PlaybookRunner;
  policyService?: PolicyService;
  approvalDal?: ApprovalDal;
  db?: SqlDb;
  identityScopeDal?: IdentityScopeDal;
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
   * See: docs/architecture/gateway/playbooks.md
   */
  app.post("/playbooks/runtime", async (c) => {
    if (!deps.policyService || !deps.approvalDal || !deps.db) {
      return c.json(
        {
          error: "unsupported",
          message: "playbook runtime is not available",
        },
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
        policyService: deps.policyService,
        approvalDal: deps.approvalDal,
        identityScopeDal: deps.identityScopeDal,
        playbooks: deps.playbooks,
        runner: deps.runner,
      },
      input.action === "run"
        ? {
            action: "run",
            pipeline: input.pipeline,
            argsJson: input.argsJson,
            cwd: input.cwd,
            maxOutputBytes: input.maxOutputBytes,
            timeoutMs: input.timeoutMs,
          }
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
   * Execute a playbook durably via workflow runs.
   */
  app.post("/playbooks/:id/execute", async (c) => {
    const tenantId = requireTenantId(c);
    if (!deps.db || !deps.policyService || !deps.identityScopeDal) {
      return c.json({ error: "unsupported", message: "workflow runtime is not enabled" }, 400);
    }

    const id = c.req.param("id");
    const pb = deps.playbooks.find((p) => p.manifest.id === id);
    if (!pb) {
      return c.json({ error: "not_found", message: `Playbook '${id}' not found` }, 404);
    }

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    let key: string;
    let agentKey: string;
    if (typeof body["key"] === "string" && body["key"].trim().length > 0) {
      key = body["key"].trim();
      try {
        const parsedKey = parseTyrumKey(key as never);
        if (parsedKey.kind !== "agent") {
          return c.json({ error: "invalid_request", message: "key must target an agent" }, 400);
        }
        agentKey = parsedKey.agent_key;
      } catch (error) {
        void error;
        return c.json({ error: "invalid_request", message: "key must be a valid agent key" }, 400);
      }
    } else {
      const primaryAgentKey = await deps.identityScopeDal.resolvePrimaryAgentKey(tenantId);
      if (!primaryAgentKey) {
        return c.json({ error: "not_found", message: "primary agent not found" }, 404);
      }
      agentKey = primaryAgentKey;
      key = `agent:${primaryAgentKey}:main`;
    }
    const resolvedAgentId = await deps.identityScopeDal.resolveAgentId(tenantId, agentKey);
    if (!resolvedAgentId) {
      return c.json({ error: "not_found", message: `agent '${agentKey}' not found` }, 404);
    }
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

    const playbookBundle = resolvePlaybookPolicyBundle(pb);

    const effectivePolicy = await deps.policyService.loadEffectiveBundle({
      tenantId,
      agentId: resolvedAgentId,
      playbookBundle,
    });
    const snapshot = await deps.policyService.getOrCreateSnapshot(tenantId, effectivePolicy.bundle);
    const workspaceId = await deps.identityScopeDal.ensureWorkspaceId(tenantId, "default");
    await deps.identityScopeDal.ensureMembership(tenantId, resolvedAgentId, workspaceId);

    const workflowRunId = await createQueuedWorkflowRunFromActions({
      db: deps.db,
      tenantId,
      agentId: resolvedAgentId,
      workspaceId,
      runKey: key,
      conversationKey: key,
      trigger: {
        kind: "api",
        metadata: {
          source: "playbook.execute",
          playbook_id: pb.manifest.id,
        },
      },
      planId,
      requestId,
      budgets,
      policySnapshotId: snapshot.policy_snapshot_id,
      actions: steps,
    });

    return c.json(
      {
        status: "ok",
        workflow_run_id: workflowRunId,
        playbook_id: pb.manifest.id,
        plan_id: planId,
        request_id: requestId,
        key,
        steps_count: steps.length,
      },
      200,
    );
  });

  return app;
}
