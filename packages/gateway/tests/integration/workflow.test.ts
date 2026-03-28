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
  it("POST /workflow/start enqueues a durable execution turn", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: { execution: { engineApiEnabled: true } },
    });
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
    const payload = (await res.json()) as { status: string; job_id: string; turn_id: string };
    expect(payload.status).toBe("ok");
    expect(payload.job_id).toBeTruthy();
    expect(payload.turn_id).toBeTruthy();

    const job = await container.db.get<{ job_id: string }>(
      "SELECT job_id FROM turn_jobs WHERE tenant_id = ? AND job_id = ?",
      [DEFAULT_TENANT_ID, payload.job_id],
    );
    expect(job?.job_id).toBe(payload.job_id);

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM turns WHERE tenant_id = ? AND turn_id = ?",
      [DEFAULT_TENANT_ID, payload.turn_id],
    );
    expect(run?.status).toBe("queued");
    const jobDetails = await container.db.get<{ key: string; trigger_json: string }>(
      "SELECT conversation_key AS key, trigger_json FROM turn_jobs WHERE tenant_id = ? AND job_id = ?",
      [DEFAULT_TENANT_ID, payload.job_id],
    );
    expect(jobDetails?.key).toBe(conversationKey);
    expect(JSON.parse(jobDetails?.trigger_json ?? "{}")).toMatchObject({
      kind: "api",
      conversation_key: conversationKey,
    });

    const stepAgg = await container.db.get<{ n: number; max_attempts: number }>(
      "SELECT COUNT(*) AS n, MIN(max_attempts) AS max_attempts FROM execution_steps WHERE tenant_id = ? AND turn_id = ?",
      [DEFAULT_TENANT_ID, payload.turn_id],
    );
    expect(stepAgg?.n).toBe(1);
    expect(stepAgg?.max_attempts).toBe(1);

    const outboxRows = await container.db.all<{ topic: string; payload_json: string }>(
      "SELECT topic, payload_json FROM outbox ORDER BY id ASC",
    );
    const messages = outboxRows
      .filter((r) => r.topic === "ws.broadcast")
      .map((r) => {
        try {
          return JSON.parse(r.payload_json) as unknown;
        } catch {
          return null;
        }
      })
      .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object");
    const types = messages
      .map((m) => (m["message"] as Record<string, unknown> | undefined)?.["type"])
      .filter((t): t is string => typeof t === "string");
    expect(types).toContain("turn.updated");
    expect(types).toContain("step.updated");

    await container.db.close();
  });

  it.each(["cron:daily-report", "hook:550e8400-e29b-41d4-a716-446655440000"])(
    "POST /workflow/start rejects non-agent conversation keys like %s",
    async (conversationKey) => {
      const { app, container } = await createTestApp({
        deploymentConfig: { execution: { engineApiEnabled: true } },
      });

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
    const { app, container } = await createTestApp({
      deploymentConfig: { execution: { engineApiEnabled: true } },
    });

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
    const jobs = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM turn_jobs WHERE tenant_id = ?",
      [DEFAULT_TENANT_ID],
    );
    expect(jobs?.n).toBe(0);

    await container.db.close();
  });

  it("POST /workflow/start rejects automation conversation keys with invalid workspace accounts", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: { execution: { engineApiEnabled: true } },
    });

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
    const jobs = await container.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM turn_jobs WHERE tenant_id = ?",
      [DEFAULT_TENANT_ID],
    );
    expect(jobs?.n).toBe(0);

    await container.db.close();
  });

  it.each([
    "agent:default:automation:default:group:heartbeat",
    "agent:default:automation:default:dm:heartbeat",
  ])(
    "POST /workflow/start rejects non-canonical automation alias keys like %s",
    async (conversationKey) => {
      const { app, container } = await createTestApp({
        deploymentConfig: { execution: { engineApiEnabled: true } },
      });

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
      const jobs = await container.db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM turn_jobs WHERE tenant_id = ?",
        [DEFAULT_TENANT_ID],
      );
      expect(jobs?.n).toBe(0);

      await container.db.close();
    },
  );

  it("POST /workflow/resume resumes a paused run via resume token", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: { execution: { engineApiEnabled: true } },
    });

    const jobId = "job-resume-1";
    const runId = "run-resume-1";
    const stepId = "step-resume-1";
    const token = "resume-test-1";
    const conversationKey = "agent:default:main";

    await container.db.run(
      `INSERT INTO turn_jobs (
         tenant_id,
         job_id,
         agent_id,
         workspace_id,
         conversation_key,
         status,
         trigger_json,
         input_json,
         latest_turn_id
       )
       VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      [
        DEFAULT_TENANT_ID,
        jobId,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        conversationKey,
        "{}",
        "{}",
        runId,
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
      [DEFAULT_TENANT_ID, runId, jobId, conversationKey],
    );
    await container.db.run(
      `INSERT INTO execution_steps (tenant_id, step_id, turn_id, step_index, status, action_json)
       VALUES (?, ?, ?, 0, 'paused', ?)`,
      [DEFAULT_TENANT_ID, stepId, runId, "{}"],
    );
    await container.db.run(
      `INSERT INTO resume_tokens (tenant_id, token, turn_id)
       VALUES (?, ?, ?)`,
      [DEFAULT_TENANT_ID, token, runId],
    );

    const res = await app.request("/workflow/resume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { status: string; turn_id: string };
    expect(payload.status).toBe("ok");
    expect(payload.turn_id).toBe(runId);

    const run = await container.db.get<{ status: string }>(
      "SELECT status FROM turns WHERE tenant_id = ? AND turn_id = ?",
      [DEFAULT_TENANT_ID, runId],
    );
    expect(run?.status).toBe("queued");

    const step = await container.db.get<{ status: string }>(
      "SELECT status FROM execution_steps WHERE tenant_id = ? AND step_id = ?",
      [DEFAULT_TENANT_ID, stepId],
    );
    expect(step?.status).toBe("queued");

    await container.db.close();
  });

  it("POST /workflow/start resolves shared policy snapshots against the scoped agent id", async () => {
    const { app, container, agents } = await createTestApp({
      deploymentConfig: { execution: { engineApiEnabled: true }, state: { mode: "shared" } },
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
    const payload = (await res.json()) as { job_id: string };
    const job = await container.db.get<{ policy_snapshot_id: string }>(
      "SELECT policy_snapshot_id FROM turn_jobs WHERE tenant_id = ? AND job_id = ?",
      [DEFAULT_TENANT_ID, payload.job_id],
    );
    const snapshot = await new PolicySnapshotDal(container.db).getById(
      DEFAULT_TENANT_ID,
      job!.policy_snapshot_id,
    );

    expect(snapshot?.bundle.tools?.require_approval).toContain("bash");

    await agents?.shutdown();
    await container.db.close();
  });

  it("POST /workflow/start preserves the workspace encoded in an automation conversation key", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: { execution: { engineApiEnabled: true } },
    });
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
    const payload = (await res.json()) as { job_id: string };
    const job = await container.db.get<{ workspace_id: string }>(
      "SELECT workspace_id FROM turn_jobs WHERE tenant_id = ? AND job_id = ?",
      [DEFAULT_TENANT_ID, payload.job_id],
    );
    expect(job?.workspace_id).toBe(travelWorkspaceId);

    await container.db.close();
  });

  it("POST /workflow/start keeps canonical external channel keys on the default workspace", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: { execution: { engineApiEnabled: true } },
    });
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
    const payload = (await res.json()) as { job_id: string };
    const job = await container.db.get<{ workspace_id: string }>(
      "SELECT workspace_id FROM turn_jobs WHERE tenant_id = ? AND job_id = ?",
      [DEFAULT_TENANT_ID, payload.job_id],
    );
    expect(job?.workspace_id).toBe(DEFAULT_WORKSPACE_ID);
    expect(job?.workspace_id).not.toBe(externalWorkspaceId);

    await container.db.close();
  });

  it("POST /workflow/start does not 500 on external channel accounts that are not valid workspace keys", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: { execution: { engineApiEnabled: true } },
    });

    const res = await app.request("/workflow/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversation_key: "agent:default:telegram:WORK:channel:chan-7",
        steps: [{ type: "CLI" }],
      }),
    });

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { job_id: string };
    const job = await container.db.get<{ workspace_id: string }>(
      "SELECT workspace_id FROM turn_jobs WHERE tenant_id = ? AND job_id = ?",
      [DEFAULT_TENANT_ID, payload.job_id],
    );
    expect(job?.workspace_id).toBe(DEFAULT_WORKSPACE_ID);

    await container.db.close();
  });
});
