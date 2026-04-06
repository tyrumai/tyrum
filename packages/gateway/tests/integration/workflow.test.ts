import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { createTestApp } from "./helpers.js";
import { buildAgentTurnKey } from "../../src/modules/agent/turn-key.js";
import { PolicyBundleConfigDal } from "../../src/modules/policy/config-dal.js";
import { PolicySnapshotDal } from "../../src/modules/policy/snapshot-dal.js";

describe("workflow routes", () => {
  it("POST /workflow/start persists a durable workflow run before execution state is materialized", async () => {
    const { app, container } = await createTestApp();
    const conversationKey = "agent:default:main";

    const res = await app.request("/workflow/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_key: conversationKey,
        steps: [{ type: "CLI" }],
      }),
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      status: string;
      workflow_run_id: string;
      plan_id: string;
      request_id: string;
      conversation_key: string;
      steps_count: number;
    };
    expect(payload.status).toBe("ok");
    expect(payload.workflow_run_id).toBeTruthy();
    expect(payload.conversation_key).toBe(conversationKey);
    expect(payload.steps_count).toBe(1);

    const run = await container.db.get<{
      workflow_run_id: string;
      run_key: string;
      conversation_key: string | null;
      status: string;
    }>(
      `SELECT workflow_run_id, run_key, conversation_key, status
       FROM workflow_runs
       WHERE tenant_id = ? AND workflow_run_id = ?`,
      [DEFAULT_TENANT_ID, payload.workflow_run_id],
    );
    expect(run).toMatchObject({
      workflow_run_id: payload.workflow_run_id,
      run_key: conversationKey,
      conversation_key: conversationKey,
      status: "queued",
    });

    const stepAgg = await container.db.get<{ n: number; max_attempts: number }>(
      `SELECT COUNT(*) AS n, MIN(max_attempts) AS max_attempts
       FROM workflow_run_steps
       WHERE tenant_id = ? AND workflow_run_id = ?`,
      [DEFAULT_TENANT_ID, payload.workflow_run_id],
    );
    expect(stepAgg?.n).toBe(1);
    expect(stepAgg?.max_attempts).toBe(1);

    const turnCount = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM turns WHERE tenant_id = ? AND turn_id = ?",
      [DEFAULT_TENANT_ID, payload.workflow_run_id],
    );
    expect(turnCount?.n).toBe(0);

    await container.db.close();
  });

  it.each(["cron:daily-report", "hook:550e8400-e29b-41d4-a716-446655440000"])(
    "POST /workflow/start rejects non-agent conversation keys like %s",
    async (conversationKey) => {
      const { app, container } = await createTestApp();

      const res = await app.request("/workflow/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_key: conversationKey,
          steps: [{ type: "CLI" }],
        }),
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
      await container.db.close();
    },
  );

  it("POST /workflow/start rejects invalid conversation keys", async () => {
    const { app, container } = await createTestApp();

    const res = await app.request("/workflow/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_key: "key-1",
        steps: [{ type: "CLI" }],
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
    const runs = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workflow_runs WHERE tenant_id = ?",
      [DEFAULT_TENANT_ID],
    );
    expect(runs?.n).toBe(0);

    await container.db.close();
  });

  it("POST /workflow/start rejects automation conversation keys with invalid workspace accounts", async () => {
    const { app, container } = await createTestApp();

    const res = await app.request("/workflow/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_key: "agent:default:automation:WORK:channel:heartbeat",
        steps: [{ type: "CLI" }],
      }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
    const runs = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workflow_runs WHERE tenant_id = ?",
      [DEFAULT_TENANT_ID],
    );
    expect(runs?.n).toBe(0);

    await container.db.close();
  });

  it.each([
    "agent:default:automation:default:group:heartbeat",
    "agent:default:automation:default:dm:heartbeat",
  ])(
    "POST /workflow/start rejects non-canonical automation alias keys like %s",
    async (conversationKey) => {
      const { app, container } = await createTestApp();

      const res = await app.request("/workflow/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_key: conversationKey,
          steps: [{ type: "CLI" }],
        }),
      });

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
      const runs = await container.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM workflow_runs WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      expect(runs?.n).toBe(0);

      await container.db.close();
    },
  );

  it("POST /workflow/resume resumes a paused workflow run via approval resume token", async () => {
    const { app, container } = await createTestApp();

    const workflowRunId = "11111111-1111-4111-8111-111111111111";
    const workflowRunStepId = "22222222-2222-4222-8222-222222222222";
    const token = "resume-test-1";
    const conversationKey = "agent:default:main";

    await container.db.run(
      `INSERT INTO workflow_runs (
         workflow_run_id,
         tenant_id,
         agent_id,
         workspace_id,
         run_key,
         conversation_key,
         status,
         trigger_json,
         blocked_reason,
         blocked_detail
       )
       VALUES (?, ?, ?, ?, ?, ?, 'paused', ?, 'approval', 'paused')`,
      [
        workflowRunId,
        DEFAULT_TENANT_ID,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        conversationKey,
        conversationKey,
        JSON.stringify({ kind: "api", metadata: { source: "test" } }),
      ],
    );
    await container.db.run(
      `INSERT INTO workflow_run_steps (
         tenant_id,
         workflow_run_step_id,
         workflow_run_id,
         step_index,
         status,
         action_json
       )
       VALUES (?, ?, ?, 0, 'paused', ?)`,
      [
        DEFAULT_TENANT_ID,
        workflowRunStepId,
        workflowRunId,
        JSON.stringify({ type: "CLI", args: { cmd: "echo", args: ["resume-test"] } }),
      ],
    );
    await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "approval:workflow-resume-test",
      prompt: "Resume the workflow run",
      motivation: "Resume the workflow run",
      kind: "policy",
      status: "approved",
      context: { source: "llm-step-tool-execution" },
      workflowRunStepId,
      resumeToken: token,
    });

    const res = await app.request("/workflow/resume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { status: string; workflow_run_id: string };
    expect(payload.status).toBe("ok");
    expect(payload.workflow_run_id).toBe(workflowRunId);

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM workflow_runs WHERE tenant_id = ? AND workflow_run_id = ?",
      [DEFAULT_TENANT_ID, workflowRunId],
    );
    expect(run?.status).toBe("queued");

    const step = await container.db.get<{ status: string }>(
      "SELECT status FROM workflow_run_steps WHERE tenant_id = ? AND workflow_run_step_id = ?",
      [DEFAULT_TENANT_ID, workflowRunStepId],
    );
    expect(step?.status).toBe("queued");

    await container.db.close();
  });

  it("POST /workflow/start resolves shared policy snapshots against the scoped agent id", async () => {
    const { app, container, agents } = await createTestApp({
      deploymentConfig: { state: { mode: "shared" } },
    });

    const helperAgentId = await container.identityScopeDal.ensureAgentId(
      DEFAULT_TENANT_ID,
      "helper",
    );
    const policyBundles = new PolicyBundleConfigDal(container.db);
    await policyBundles.set({
      scope: { tenantId: DEFAULT_TENANT_ID, scopeKind: "deployment" },
      bundle: {
        v: 1,
        tools: { default: "deny", allow: ["bash"], require_approval: [], deny: [] },
      },
      createdBy: { kind: "test" },
    });
    await policyBundles.set({
      scope: { tenantId: DEFAULT_TENANT_ID, scopeKind: "agent", agentId: helperAgentId },
      bundle: {
        v: 1,
        tools: { default: "deny", allow: [], require_approval: ["bash"], deny: [] },
      },
      createdBy: { kind: "test" },
    });

    const res = await app.request("/workflow/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_key: "agent:helper:main",
        steps: [{ type: "CLI" }],
      }),
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { workflow_run_id: string };
    const run = await container.db.get<{ policy_snapshot_id: string }>(
      `SELECT policy_snapshot_id
       FROM workflow_runs
       WHERE tenant_id = ? AND workflow_run_id = ?`,
      [DEFAULT_TENANT_ID, payload.workflow_run_id],
    );
    const snapshot = await new PolicySnapshotDal(container.db).getById(
      DEFAULT_TENANT_ID,
      run!.policy_snapshot_id,
    );

    expect(snapshot?.bundle.tools?.require_approval).toContain("bash");

    await agents?.shutdown();
    await container.db.close();
  });

  it("POST /workflow/start preserves the workspace encoded in an automation conversation key", async () => {
    const { app, container } = await createTestApp();
    const travelWorkspaceId = await container.identityScopeDal.ensureWorkspaceId(
      DEFAULT_TENANT_ID,
      "travel",
    );
    const conversationKey = buildAgentTurnKey({
      agentId: "default",
      workspaceId: "travel",
      channel: "automation",
      containerKind: "channel",
      threadId: "api-workspace-test",
    });

    const res = await app.request("/workflow/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_key: conversationKey,
        steps: [{ type: "CLI" }],
      }),
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { workflow_run_id: string };
    const run = await container.db.get<{ workspace_id: string }>(
      `SELECT workspace_id
       FROM workflow_runs
       WHERE tenant_id = ? AND workflow_run_id = ?`,
      [DEFAULT_TENANT_ID, payload.workflow_run_id],
    );
    expect(run?.workspace_id).toBe(travelWorkspaceId);

    await container.db.close();
  });

  it("POST /workflow/start keeps canonical external channel keys on the default workspace", async () => {
    const { app, container } = await createTestApp();
    const externalWorkspaceId = await container.identityScopeDal.ensureWorkspaceId(
      DEFAULT_TENANT_ID,
      "work",
    );

    const res = await app.request("/workflow/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_key: "agent:default:telegram:work:channel:chan-7",
        steps: [{ type: "CLI" }],
      }),
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { workflow_run_id: string };
    const run = await container.db.get<{ workspace_id: string }>(
      `SELECT workspace_id
       FROM workflow_runs
       WHERE tenant_id = ? AND workflow_run_id = ?`,
      [DEFAULT_TENANT_ID, payload.workflow_run_id],
    );
    expect(run?.workspace_id).toBe(DEFAULT_WORKSPACE_ID);
    expect(run?.workspace_id).not.toBe(externalWorkspaceId);

    await container.db.close();
  });

  it("POST /workflow/start does not 500 on external channel accounts that are not valid workspace keys", async () => {
    const { app, container } = await createTestApp();

    const res = await app.request("/workflow/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_key: "agent:default:telegram:WORK:channel:chan-7",
        steps: [{ type: "CLI" }],
      }),
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { workflow_run_id: string };
    const run = await container.db.get<{ workspace_id: string }>(
      `SELECT workspace_id
       FROM workflow_runs
       WHERE tenant_id = ? AND workflow_run_id = ?`,
      [DEFAULT_TENANT_ID, payload.workflow_run_id],
    );
    expect(run?.workspace_id).toBe(DEFAULT_WORKSPACE_ID);

    await container.db.close();
  });
});
