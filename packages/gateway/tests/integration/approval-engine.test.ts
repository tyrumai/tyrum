import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createTestContainer } from "./helpers.js";

describe("approval routes (engine integration)", () => {
  const originalFlag = process.env["TYRUM_ENGINE_API_ENABLED"];

  beforeEach(() => {
    process.env["TYRUM_ENGINE_API_ENABLED"] = "1";
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env["TYRUM_ENGINE_API_ENABLED"];
    } else {
      process.env["TYRUM_ENGINE_API_ENABLED"] = originalFlag;
    }
  });

  it("resumes an engine-scoped paused run when an approval is approved", async () => {
    const container = await createTestContainer();
    const app = createApp(container);

    const jobId = "job-approval-1";
    const runId = "run-approval-1";
    const stepId = "step-approval-1";
    const resumeToken = "resume-approval-1";

    const approval = await container.approvalDal.create({
      planId: "plan-approval-1",
      stepIndex: 0,
      kind: "takeover",
      prompt: "Takeover required",
      runId,
      resumeToken,
    });

    await container.db.run(
      `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id)
       VALUES (?, ?, ?, 'queued', ?, ?, ?)`,
      [jobId, "agent:agent-1:telegram-1:group:thread-1", "main", "{}", "{}", runId],
    );
    await container.db.run(
      `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt, paused_reason, paused_detail)
       VALUES (?, ?, ?, ?, 'paused', 1, 'takeover', 'paused')`,
      [runId, jobId, "agent:agent-1:telegram-1:group:thread-1", "main"],
    );
    await container.db.run(
      `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json, approval_id)
       VALUES (?, ?, 0, 'paused', ?, ?)`,
      [stepId, runId, JSON.stringify({ type: "CLI", args: {} }), approval.id],
    );
    await container.db.run(
      `INSERT INTO resume_tokens (token, run_id)
       VALUES (?, ?)`,
      [resumeToken, runId],
    );

    const res = await app.request(`/approvals/${String(approval.id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(res.status).toBe(200);

    const run = await container.db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE run_id = ?",
      [runId],
    );
    expect(run?.status).toBe("queued");
    expect(run?.paused_reason).toBeNull();

    const step = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE step_id = ?",
      [stepId],
    );
    expect(step?.status).toBe("queued");

    const tokenRow = await container.db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM resume_tokens WHERE token = ?",
      [resumeToken],
    );
    expect(tokenRow?.revoked_at).toBeTruthy();

    await container.db.close();
  });
});

