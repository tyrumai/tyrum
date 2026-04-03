import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepExecutor } from "../../src/modules/execution/engine.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import {
  createRuntimeContext,
  runtimeJsonHeaders,
  waitForWorkflowRunId,
} from "./playbook-runtime.test-support.js";

const INLINE_PLAYBOOK = `
id: inline-runtime-test
name: Inline runtime test
version: "1.0.0"
steps:
  - id: step-1
    command: web navigate https://example.com
`.trim();

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe("POST /playbooks/runtime workflow-run durability", () => {
  let homeDir: string | undefined;
  const originalEnv = {
    TYRUM_POLICY_ENABLED: process.env["TYRUM_POLICY_ENABLED"],
    TYRUM_POLICY_MODE: process.env["TYRUM_POLICY_MODE"],
    TYRUM_POLICY_BUNDLE_PATH: process.env["TYRUM_POLICY_BUNDLE_PATH"],
    TYRUM_HOME: process.env["TYRUM_HOME"],
  };

  beforeEach(() => {
    process.env["TYRUM_POLICY_ENABLED"] = "1";
    process.env["TYRUM_POLICY_MODE"] = "enforce";
    delete process.env["TYRUM_POLICY_BUNDLE_PATH"];
    delete process.env["TYRUM_HOME"];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    restoreEnv("TYRUM_POLICY_ENABLED", originalEnv.TYRUM_POLICY_ENABLED);
    restoreEnv("TYRUM_POLICY_MODE", originalEnv.TYRUM_POLICY_MODE);
    restoreEnv("TYRUM_POLICY_BUNDLE_PATH", originalEnv.TYRUM_POLICY_BUNDLE_PATH);
    restoreEnv("TYRUM_HOME", originalEnv.TYRUM_HOME);

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("persists workflow runs before execution turns are materialized", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-"));
    const { container, engine, app } = await createRuntimeContext(homeDir);

    try {
      const resPromise = app.request("/playbooks/runtime", {
        method: "POST",
        headers: runtimeJsonHeaders,
        body: JSON.stringify({
          action: "run",
          pipeline: INLINE_PLAYBOOK,
          timeoutMs: 2_000,
        }),
      });

      const workflowRunId = await waitForWorkflowRunId(container);
      const workflowRun = await container.db.get<{ status: string }>(
        `SELECT status
         FROM workflow_runs
         WHERE tenant_id = ?
           AND workflow_run_id = ?`,
        [DEFAULT_TENANT_ID, workflowRunId],
      );
      expect(workflowRun?.status).toBe("queued");

      const workflowStepCount = await container.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM workflow_run_steps
         WHERE tenant_id = ?
           AND workflow_run_id = ?`,
        [DEFAULT_TENANT_ID, workflowRunId],
      );
      expect(workflowStepCount?.n).toBe(1);

      const turnCountBeforeMaterialization = await container.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n
         FROM turns
         WHERE tenant_id = ?
           AND turn_id = ?`,
        [DEFAULT_TENANT_ID, workflowRunId],
      );
      expect(turnCountBeforeMaterialization?.n).toBe(0);

      const executor: StepExecutor = {
        execute: vi.fn(async () => {
          throw new Error("step execution should not run before policy approval");
        }),
      };
      await engine.workerTick({ workerId: "w1", executor, turnId: workflowRunId });

      const res = await resPromise;
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        status: string;
        requiresApproval?: { resumeToken?: string };
      };
      expect(body.ok).toBe(true);
      expect(body.status).toBe("needs_approval");
      expect(body.requiresApproval?.resumeToken).toBeTruthy();
    } finally {
      await container.db.close();
    }
  });
});
