import { beforeEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { ExecutionEngine } from "../../src/modules/execution/engine.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { loadAllPlaybooks } from "../../src/modules/playbook/loader.js";
import { PlaybookRunner } from "../../src/modules/playbook/runner.js";
import { DEFAULT_TENANT_ID, IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../fixtures/playbooks");

const sentinelBundle = { sentinel: "playbook-bundle" };

const resolvePlaybookPolicyBundle = vi.fn(() => sentinelBundle);
const runPlaybookRuntimeEnvelope = vi.fn();

vi.mock("../../src/modules/playbook/runtime.js", () => {
  return {
    runPlaybookRuntimeEnvelope,
    resolvePlaybookPolicyBundle,
  };
});

describe("POST /playbooks/:id/execute (policy bundle)", () => {
  beforeEach(() => {
    resolvePlaybookPolicyBundle.mockClear();
    runPlaybookRuntimeEnvelope.mockClear();
  });

  it("delegates bundle resolution to resolvePlaybookPolicyBundle", async () => {
    const { createPlaybookRoutes } = await import("../../src/routes/playbook.js");

    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const runner = new PlaybookRunner();

    const loadEffectiveBundle = vi.fn(async (_: unknown) => ({ bundle: { v: 1 } }));
    const getOrCreateSnapshot = vi.fn(async (_: unknown) => ({ policy_snapshot_id: "snap-1" }));
    const policyService = {
      loadEffectiveBundle,
      getOrCreateSnapshot,
    } as unknown as PolicyService;

    const enqueuePlan = vi.fn(async () => ({ jobId: "job-1", runId: "run-1" }));
    const engine = { enqueuePlan } as unknown as ExecutionEngine;
    const db = openTestSqliteDb();
    const identityScopeDal = new IdentityScopeDal(db);

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });
      return await next();
    });
    app.route(
      "/",
      createPlaybookRoutes({ playbooks, runner, engine, policyService, db, identityScopeDal }),
    );

    try {
      const res = await app.request("/playbooks/test-playbook/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "agent:default:main", lane: "lane-1" }),
      });
      expect(res.status).toBe(200);

      expect(resolvePlaybookPolicyBundle).toHaveBeenCalledTimes(1);
      expect(loadEffectiveBundle).toHaveBeenCalledWith({
        tenantId: DEFAULT_TENANT_ID,
        agentId: "00000000-0000-4000-8000-000000000002",
        playbookBundle: sentinelBundle,
      });
    } finally {
      await db.close();
    }
  });

  it("returns 404 for a missing explicit agent key", async () => {
    const { createPlaybookRoutes } = await import("../../src/routes/playbook.js");

    const playbooks = loadAllPlaybooks(fixturesDir, { onInvalidPlaybook: () => {} });
    const runner = new PlaybookRunner();
    const policyService = {
      loadEffectiveBundle: vi.fn(async () => ({ bundle: { v: 1 } })),
      getOrCreateSnapshot: vi.fn(async () => ({ policy_snapshot_id: "snap-1" })),
    } as unknown as PolicyService;
    const engine = {
      enqueuePlan: vi.fn(async () => ({ jobId: "job-1", runId: "run-1" })),
    } as unknown as ExecutionEngine;
    const db = openTestSqliteDb();
    const identityScopeDal = new IdentityScopeDal(db);

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      });
      return await next();
    });
    app.route(
      "/",
      createPlaybookRoutes({ playbooks, runner, engine, policyService, db, identityScopeDal }),
    );

    try {
      const res = await app.request("/playbooks/test-playbook/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "agent:missing-agent:main" }),
      });

      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toMatchObject({
        error: "not_found",
        message: "agent 'missing-agent' not found",
      });
    } finally {
      await db.close();
    }
  });
});
