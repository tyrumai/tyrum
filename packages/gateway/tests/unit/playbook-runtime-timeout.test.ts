import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { runPlaybookRuntimeEnvelope } from "../../src/modules/playbook/runtime.js";
import { waitForPlaybookRuntimeResume } from "../../src/modules/playbook/runtime-execution-support.js";
import { ApprovalEngineActionProcessor } from "../../src/modules/approval/engine-action-processor.js";
import { PlaybookRunner } from "../../src/modules/playbook/runner.js";
import { WorkflowRunDal } from "../../src/modules/workflow-run/dal.js";
import { createWorkflowRunRunner } from "../../src/modules/workflow-run/create-runner.js";
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

async function waitForWorkflowRunStatus(
  container: GatewayContainer,
  workflowRunId: string,
  statuses: readonly string[],
  timeoutMs = 1_000,
): Promise<string> {
  const wanted = new Set(statuses);
  const deadline = Date.now() + Math.max(1, timeoutMs);

  while (Date.now() < deadline) {
    const row = await container.db.get<{ status: string }>(
      "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
      [workflowRunId],
    );
    const status = row?.status?.trim();
    if (status && wanted.has(status)) {
      return status;
    }
    await sleep(10);
  }

  throw new Error(`timed out waiting for workflow run status: ${statuses.join(", ")}`);
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

    const runner = new PlaybookRunner();
    const workflow = await new WorkflowRunDal(container.db).createRunWithSteps({
      run: {
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        runKey: "playbook:inline-runtime-timeout-test",
        trigger: {
          kind: "api",
          metadata: { source: "playbook-runtime" },
        },
        planId: "plan-resume-timeout-1",
        requestId: "req-resume-timeout-1",
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
      `UPDATE workflow_runs
       SET status = 'paused',
           blocked_reason = 'manual',
           blocked_detail = 'paused'
       WHERE tenant_id = ?
         AND workflow_run_id = ?`,
      [DEFAULT_TENANT_ID, workflow.run.workflow_run_id],
    );
    await container.db.run(
      `UPDATE workflow_run_steps
       SET status = 'paused'
       WHERE tenant_id = ?
         AND workflow_run_id = ?`,
      [DEFAULT_TENANT_ID, workflow.run.workflow_run_id],
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
      workflowRunStepId: workflow.steps[0]?.workflow_run_step_id,
      resumeToken,
    });

    const timeoutMs = 100;
    const start = Date.now();
    const envelopePromise = runPlaybookRuntimeEnvelope(
      {
        db: container.db,
        policyService: container.policyService,
        approvalDal: container.approvalDal,
        playbooks: [],
        runner,
      },
      { action: "resume", token: resumeToken, approve: true, timeoutMs },
    ).then((envelope) => ({ envelope, resolvedAt: Date.now() }));

    await vi.advanceTimersByTimeAsync(90);
    await container.db.run(
      `UPDATE workflow_runs
       SET status = 'queued'
       WHERE tenant_id = ?
         AND workflow_run_id = ?`,
      [DEFAULT_TENANT_ID, workflow.run.workflow_run_id],
    );
    await vi.advanceTimersByTimeAsync(500);

    const { envelope, resolvedAt } = await envelopePromise;
    expect(envelope.ok).toBe(false);
    expect(envelope.status).toBe("error");
    expect(envelope.error?.code).toBe("timeout");
    expect(resolvedAt - start).toBeLessThanOrEqual(150);
  });

  it("treats workflow-run approvals without resume tokens as still pending", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-timeout-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

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
        planId: "plan-playbook-runtime-pending-approval-1",
        requestId: "req-playbook-runtime-pending-approval-1",
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
      "UPDATE workflow_runs SET status = 'paused' WHERE tenant_id = ? AND workflow_run_id = ?",
      [DEFAULT_TENANT_ID, workflow.run.workflow_run_id],
    );

    const workflowRunStepId = workflow.steps[0]?.workflow_run_step_id;
    if (!workflowRunStepId) {
      throw new Error("expected workflow step id");
    }

    await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "approval-workflow-missing-resume-token-1",
      prompt: "Approve playbook runtime resume",
      motivation: "Workflow-run pause checks should not require a resume token.",
      kind: "policy",
      status: "awaiting_human",
      workflowRunStepId,
      resumeToken: null,
    });

    await expect(
      waitForPlaybookRuntimeResume(container.db, workflow.run.workflow_run_id, 10),
    ).resolves.toBeUndefined();
  });

  it("resumes approvals linked only through workflow_run_step_id", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-playbook-runtime-timeout-"));
    container = createContainer({ dbPath: ":memory:", migrationsDir, tyrumHome: homeDir });

    const runner = new PlaybookRunner();
    const workflowRunner = createWorkflowRunRunner(container);

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
      `UPDATE workflow_runs
       SET status = 'paused',
           blocked_reason = 'policy',
           blocked_detail = 'paused for approval'
       WHERE tenant_id = ?
         AND workflow_run_id = ?`,
      [DEFAULT_TENANT_ID, workflow.run.workflow_run_id],
    );
    await container.db.run(
      `UPDATE workflow_run_steps
       SET status = 'paused'
       WHERE tenant_id = ?
         AND workflow_run_step_id = ?`,
      [DEFAULT_TENANT_ID, workflow.steps[0]?.workflow_run_step_id],
    );

    const resumeToken = "resume-workflow-step-only-1";
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
      resumeToken,
    });

    const processor = new ApprovalEngineActionProcessor({
      db: container.db,
      workflowRunner,
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
          policyService: container.policyService,
          approvalDal: container.approvalDal,
          playbooks: [],
          runner,
        },
        { action: "resume", token: resumeToken, approve: true, timeoutMs: 2_000 },
      );

      await waitForWorkflowRunStatus(container, workflow.run.workflow_run_id, ["queued"]);

      const executor: StepExecutor = {
        execute: vi.fn(async () => ({ success: true, result: { ok: true } })),
      };
      for (let i = 0; i < 10; i += 1) {
        await workflowRunner.workerTick({
          workerId: "w1",
          executor,
          workflowRunId: workflow.run.workflow_run_id,
        });
        const row = await container.db.get<{ status: string }>(
          "SELECT status FROM workflow_runs WHERE workflow_run_id = ?",
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
