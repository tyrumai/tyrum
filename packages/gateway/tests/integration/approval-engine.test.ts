import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import {
  createTestContainer,
  decorateAppWithDefaultAuth,
  drainApprovalEngineActions,
} from "./helpers.js";
import { seedPausedExecutionRun } from "../helpers/execution-fixtures.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import { ExecutionEngine } from "../../src/modules/execution/engine.js";

describe("approval routes (engine integration)", () => {
  it("resumes an engine-scoped paused run when an approval is approved", async () => {
    const container = await createTestContainer();
    const authTokens = new AuthTokenService(container.db);
    const tenantToken = await authTokens.issueToken({
      tenantId: DEFAULT_TENANT_ID,
      role: "admin",
      scopes: ["*"],
    });
    const engine = new ExecutionEngine({ db: container.db });
    const app = createApp(container, { authTokens, engine });
    decorateAppWithDefaultAuth(app, tenantToken.token);

    const jobId = "job-approval-1";
    const runId = "run-approval-1";
    const stepId = "step-approval-1";
    const resumeToken = "resume-approval-1";

    await seedPausedExecutionRun({
      db: container.db,
      jobId,
      runId,
      key: "agent:agent-1:telegram-1:group:thread-1",
      pausedReason: "takeover",
      pausedDetail: "paused",
    });

    const approval = await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "approval-engine-resume",
      kind: "takeover",
      prompt: "Takeover required",
      motivation: "Resume the paused engine run after the takeover approval is granted.",
      runId,
      resumeToken,
    });
    await container.db.run(
      `INSERT INTO execution_steps (
         tenant_id,
         step_id,
         run_id,
         step_index,
         status,
         action_json,
         approval_id
       )
       VALUES (?, ?, ?, 0, 'paused', ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        stepId,
        runId,
        JSON.stringify({ type: "CLI", args: {} }),
        approval.approval_id,
      ],
    );
    await container.db.run(
      `INSERT INTO resume_tokens (tenant_id, token, run_id)
       VALUES (?, ?, ?)`,
      [DEFAULT_TENANT_ID, resumeToken, runId],
    );

    const res = await app.request(`/approvals/${String(approval.approval_id)}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    expect(res.status).toBe(200);

    await drainApprovalEngineActions({ container });

    const run = await container.db.get<{ status: string; paused_reason: string | null }>(
      "SELECT status, paused_reason FROM execution_runs WHERE tenant_id = ? AND run_id = ?",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(run?.status).toBe("queued");
    expect(run?.paused_reason).toBeNull();

    const step = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE tenant_id = ? AND step_id = ?",
      [DEFAULT_TENANT_ID, stepId],
    );
    expect(step?.status).toBe("queued");

    const tokenRow = await container.db.get<{ revoked_at: string | null }>(
      "SELECT revoked_at FROM resume_tokens WHERE tenant_id = ? AND token = ?",
      [DEFAULT_TENANT_ID, resumeToken],
    );
    expect(tokenRow?.revoked_at).toBeTruthy();

    await container.db.close();
  });
});
