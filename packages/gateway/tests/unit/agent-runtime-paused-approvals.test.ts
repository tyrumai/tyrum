import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { AgentRuntime } from "../../src/modules/agent/runtime.js";
import { maybeResolvePausedRun } from "../../src/modules/agent/runtime/turn-engine-bridge.js";

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
    const lane = "main";
    const jobId = "job-1";
    const runId = "run-1";

    await container.db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json)
       VALUES (?, ?, ?, ?, ?)`,
      [jobId, key, lane, "queued", "{}"],
    );
    await container.db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [runId, jobId, key, lane, "paused", 1],
    );

    const resumeToken = "resume-token-from-context";
    const approval = await container.approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "approve",
      runId,
      context: { resume_token: resumeToken },
    });
    await container.approvalDal.respond(approval.id, true, "approved");

    await container.db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json, approval_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["step-1", runId, 0, "paused", "{}", approval.id],
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
