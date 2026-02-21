/**
 * Policy v2 routes — configurable PolicyBundle-based evaluation.
 *
 * GET  /policy/bundle           — current merged policy bundle state
 * GET  /policy/snapshot/:run_id — stored policy snapshot for a run
 * POST /policy/evaluate         — evaluate a domain against current policy
 */

import { Hono } from "hono";
import type { PolicyBundleManager } from "../modules/policy/bundle.js";
import type { PolicySnapshotDal } from "../modules/policy/snapshot-dal.js";

export interface PolicyV2RouteDeps {
  bundleManager: PolicyBundleManager;
  snapshotDal: PolicySnapshotDal;
}

export function createPolicyV2Routes(deps: PolicyV2RouteDeps): Hono {
  const app = new Hono();

  // GET /policy/bundle — current merged policy bundle
  app.get("/policy/bundle", (c) => {
    return c.json({
      bundles: deps.bundleManager.getBundles(),
      merged_rules: deps.bundleManager.getMergedRules(),
    });
  });

  // GET /policy/snapshot/:run_id — snapshot for a specific run
  app.get("/policy/snapshot/:run_id", async (c) => {
    const runId = c.req.param("run_id");
    const snapshot = await deps.snapshotDal.getByRunId(runId);
    if (!snapshot) {
      return c.json(
        { error: "not_found", message: "no policy snapshot for this run" },
        404,
      );
    }
    let bundle: unknown;
    try {
      bundle = JSON.parse(snapshot.bundle_json) as unknown;
    } catch {
      bundle = null;
    }
    return c.json({
      snapshot_id: snapshot.snapshot_id,
      run_id: snapshot.run_id,
      bundle,
      created_at: snapshot.created_at,
    });
  });

  // POST /policy/evaluate — evaluate a domain against current policy
  app.post("/policy/evaluate", async (c) => {
    const body = (await c.req.json()) as {
      domain?: string;
      context?: unknown;
    };
    if (!body.domain) {
      return c.json(
        { error: "invalid_request", message: "domain is required" },
        400,
      );
    }
    const result = deps.bundleManager.evaluate(body.domain, body.context as Record<string, unknown> | undefined);
    return c.json(result);
  });

  return app;
}
