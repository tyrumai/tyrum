import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { maybeResolvePausedRun } from "../../src/modules/agent/runtime/turn-engine-bridge.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("AgentRuntime paused approvals", () => {
  let homeDir: string | undefined;
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("resumes an approved paused run when the resume_token is stored only in approval context", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-agent-runtime-paused-"));
    container = await createContainer({
      dbPath: ":memory:",
      migrationsDir,
    });

    const runtime = new AgentRuntime({ container, home: homeDir });

    const key = "agent:default:test:thread-1";
    const jobId = randomUUID();
    const runId = randomUUID();

    await container.db.run(
      `INSERT INTO turn_jobs (
	         tenant_id,
	         job_id,
	         agent_id,
	         workspace_id,
	         conversation_key,
	         status,
	         trigger_json
	       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, jobId, DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID, key, "queued", "{}"],
    );
    await container.db.run(
      `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt)
	       VALUES (?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, runId, jobId, key, "paused", 1],
    );

    const resumeToken = "resume-token-from-context";
    const approval = await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: `approval:${randomUUID()}`,
      prompt: "approve",
      motivation: "Resume the paused run using the token stored in approval context.",
      kind: "workflow_step",
      runId,
      context: { resume_token: resumeToken },
    });
    await container.approvalDal.respond({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "approved",
      reason: "approved",
    });

    await container.db.run(
      `INSERT INTO execution_steps (
	         tenant_id,
	         step_id,
	         turn_id,
	         step_index,
	         status,
	         action_json,
	         approval_id
	       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, randomUUID(), runId, 0, "paused", "{}", approval.approval_id],
    );

    const resumeRun = vi
      .spyOn((runtime as any).executionEngine, "resumeRun")
      .mockResolvedValue(runId);
    const cancelRun = vi
      .spyOn((runtime as any).executionEngine, "cancelRun")
      .mockResolvedValue("cancelled");

    const resolved = await maybeResolvePausedRun(
      {
        approvalDal: container.approvalDal,
        db: container.db,
        executionEngine: (runtime as any).executionEngine,
      },
      runId,
    );

    expect(resolved).toBe(true);
    expect(resumeRun).toHaveBeenCalledWith(resumeToken);
    expect(cancelRun).not.toHaveBeenCalled();
  });
});
