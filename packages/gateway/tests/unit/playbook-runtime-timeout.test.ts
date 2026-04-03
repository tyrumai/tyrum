import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { runPlaybookRuntimeEnvelope } from "../../src/modules/playbook/runtime.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";
import { ApprovalEngineActionProcessor } from "../../src/modules/approval/engine-action-processor.js";
import { PlaybookRunner } from "../../src/modules/playbook/runner.js";
import { WorkflowRunDal } from "../../src/modules/workflow-run/dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import type { StepExecutor } from "../../src/modules/execution/engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTurnStatus(
  container: GatewayContainer,
  turnId: string,
  statuses: readonly string[],
  timeoutMs = 1_000,
): Promise<string> {
  const wanted = new Set(statuses);
  const deadline = Date.now() + Math.max(1, timeoutMs);

  while (Date.now() < deadline) {
    const row = await container.db.get<{ status: string }>(
      "SELECT status FROM turns WHERE turn_id = ?",
      [turnId],
    );
    if (row?.status && wanted.has(row.status)) {
      return row.status;
    }
    await sleep(5);
  }

  throw new Error(`timed out waiting for turn status: ${statuses.join(", ")}`);
}

describe("playbook runtime resume timeout", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    vi.useRealTimers();

    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("does not double timeout budget when resuming", async () => {
    vi.useFakeTimers();

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-timeout-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const runner = new PlaybookRunner();

    const jobId = "job-resume-timeout-1";
    const turnId = "run-resume-timeout-1";

    await container.db.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_id,
         conversation_key,
         status,
         trigger_json,
         input_json,
         latest_turn_id
       )
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        jobId,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        null,
        "key-1",
        "{}",
        "{}",
        turnId,
      ],
    );
    await container.db.run(
      `INSERT INTO turns (
         tenant_id,
         turn_id,
         job_id,
         conversation_key,
         status,
         attempt,
         blocked_reason,
         blocked_detail
       )
       VALUES (?, ?, ?, ?, 'paused', 1, 'test', 'paused')`,
      [DEFAULT_TENANT_ID, turnId, jobId, "key-1"],
    );

    const resumeToken = "resume-resolve-timeout-1";
    await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "approval-resume-timeout-1",
      prompt: "test",
      motivation: "Resume tokens should respect the original timeout budget.",
      kind: "policy",
      status: "awaiting_human",
      turnId,
      resumeToken,
    });

    const timeoutMs = 100;
    const start = Date.now();
    const envelopePromise = runPlaybookRuntimeEnvelope(
      {
        db: container.db,
        engine,
        policyService: container.policyService,
        approvalDal: container.approvalDal,
        playbooks: [],
        runner,
      },
      { action: "resume", token: resumeToken, approve: true, timeoutMs },
    ).then((envelope) => ({ envelope, resolvedAt: Date.now() }));

    await vi.advanceTimersByTimeAsync(90);
    await container.db.run(
      "UPDATE turns SET status = 'queued' WHERE tenant_id = ? AND turn_id = ?",
      [DEFAULT_TENANT_ID, turnId],
    );
    await vi.advanceTimersByTimeAsync(500);

    const { envelope, resolvedAt } = await envelopePromise;
    expect(envelope.ok).toBe(false);
    expect(envelope.status).toBe("error");
    expect(envelope.error?.code).toBe("timeout");
    expect(resolvedAt - start).toBeLessThanOrEqual(150);
  });

  it("resumes approvals linked only through workflow_run_step_id", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-timeout-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const engine = new ExecutionEngine({
      db: container.db,
      redactionEngine: container.redactionEngine,
      policyService: container.policyService,
      logger: container.logger,
    });
    const runner = new PlaybookRunner();

    const workflow = await new WorkflowRunDal(container.db).createRunWithSteps({
      run: {
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        runKey: "playbook:inline-runtime-test",
        trigger: {
          kind: "api",
          metadata: { source: "playbook-runtime" },
        },
        planId: "plan-playbook-runtime-resume-1",
        requestId: "req-playbook-runtime-resume-1",
      },
      steps: [
        {
          action: {
            type: "CLI",
            args: {
              command: "echo hi",
            },
          },
        },
      ],
    });

    await container.db.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_id,
         conversation_key,
         status,
         trigger_json,
         input_json,
         latest_turn_id
       )
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        workflow.run.workflow_run_id,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        null,
        workflow.run.run_key,
        JSON.stringify(workflow.run.trigger),
        "{}",
        workflow.run.workflow_run_id,
      ],
    );
    await container.db.run(
      `INSERT INTO turns (
         tenant_id,
         turn_id,
         job_id,
         conversation_key,
         status,
         attempt,
         blocked_reason,
         blocked_detail
       )
       VALUES (?, ?, ?, ?, 'paused', 1, 'policy', 'paused for approval')`,
      [
        DEFAULT_TENANT_ID,
        workflow.run.workflow_run_id,
        workflow.run.workflow_run_id,
        workflow.run.run_key,
      ],
    );
    await container.db.run(
      `INSERT INTO execution_steps (
         tenant_id,
         step_id,
         turn_id,
         step_index,
         status,
         action_json
       )
       VALUES (?, ?, ?, 0, 'paused', ?)`,
      [
        DEFAULT_TENANT_ID,
        "40000000-0000-4000-8000-000000000001",
        workflow.run.workflow_run_id,
        JSON.stringify({ type: "CLI", args: { command: "echo hi" } }),
      ],
    );

    const resumeToken = "resume-workflow-step-only-1";
    await container.db.run(
      `INSERT INTO resume_tokens (tenant_id, token, turn_id, created_at)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, resumeToken, workflow.run.workflow_run_id, new Date().toISOString()],
    );
    await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "approval-workflow-step-only-1",
      prompt: "Approve playbook runtime resume",
      motivation: "workflow_run_step_id should be enough to resolve the run",
      kind: "policy",
      status: "awaiting_human",
      workflowRunStepId: workflow.steps[0]?.workflow_run_step_id,
      stepId: "40000000-0000-4000-8000-000000000001",
      resumeToken,
    });

    const processor = new ApprovalEngineActionProcessor({
      db: container.db,
      engine,
      owner: "test-instance",
      logger: container.logger,
      tickMs: 1,
      leaseTtlMs: 5_000,
      maxAttempts: 10,
      batchSize: 10,
    });
    processor.start();

    try {
      const envelopePromise = runPlaybookRuntimeEnvelope(
        {
          db: container.db,
          engine,
          policyService: container.policyService,
          approvalDal: container.approvalDal,
          playbooks: [],
          runner,
        },
        { action: "resume", token: resumeToken, approve: true, timeoutMs: 2_000 },
      );

      await waitForTurnStatus(container, workflow.run.workflow_run_id, ["queued"]);

      const executor: StepExecutor = {
        execute: vi.fn(async () => ({ success: true, result: { ok: true } })),
      };
      for (let i = 0; i < 10; i += 1) {
        await engine.workerTick({
          workerId: "w1",
          executor,
          turnId: workflow.run.workflow_run_id,
        });
        const row = await container.db.get<{ status: string }>(
          "SELECT status FROM turns WHERE turn_id = ?",
          [workflow.run.workflow_run_id],
        );
        if (row?.status === "succeeded") {
          break;
        }
      }

      const envelope = await envelopePromise;
      expect(envelope.ok).toBe(true);
      expect(envelope.status).toBe("ok");
    } finally {
      processor.stop();
    }
  });
});
