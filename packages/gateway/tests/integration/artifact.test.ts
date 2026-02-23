import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../src/app.js";
import { createTestContainer } from "./helpers.js";

type SqlRunner = {
  run(sql: string, params?: unknown[]): Promise<unknown>;
};

type ExecutionScopeIds = {
  jobId: string;
  runId: string;
  stepId: string;
  attemptId: string;
};

async function seedExecutionScope(db: SqlRunner, ids: ExecutionScopeIds): Promise<void> {
  await db.run(
    `INSERT INTO execution_jobs (job_id, key, lane, status, trigger_json, input_json, latest_run_id)
     VALUES (?, ?, ?, 'running', ?, ?, ?)`,
    [ids.jobId, "agent:agent-1:thread:thread-1", "main", "{}", "{}", ids.runId],
  );

  await db.run(
    `INSERT INTO execution_runs (run_id, job_id, key, lane, status, attempt)
     VALUES (?, ?, ?, ?, 'running', 1)`,
    [ids.runId, ids.jobId, "agent:agent-1:thread:thread-1", "main"],
  );

  await db.run(
    `INSERT INTO execution_steps (step_id, run_id, step_index, status, action_json)
     VALUES (?, ?, 0, 'running', ?)`,
    [ids.stepId, ids.runId, "{}"],
  );

  await db.run(
    `INSERT INTO execution_attempts (attempt_id, step_id, attempt, status, artifacts_json)
     VALUES (?, ?, 1, 'running', '[]')`,
    [ids.attemptId, ids.stepId],
  );
}

describe("artifact routes", () => {
  let originalTyrumHome: string | undefined;
  let homeDir: string | undefined;

  beforeEach(async () => {
    originalTyrumHome = process.env["TYRUM_HOME"];
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-artifacts-"));
    process.env["TYRUM_HOME"] = homeDir;
  });

  afterEach(async () => {
    if (originalTyrumHome === undefined) {
      delete process.env["TYRUM_HOME"];
    } else {
      process.env["TYRUM_HOME"] = originalTyrumHome;
    }

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("GET /artifacts/:id rejects bare artifact_id-only fetch paths", async () => {
    const container = await createTestContainer();
    const app = createApp(container);

    const ref = await container.artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("hello", "utf8"),
      labels: ["log"],
      metadata: { test: true },
    });

    const metaRes = await app.request(`/artifacts/${ref.artifact_id}/metadata`);
    expect(metaRes.status).toBe(400);

    const res = await app.request(`/artifacts/${ref.artifact_id}`);
    expect(res.status).toBe(400);

    await container.db.close();
  });

  it("GET /runs/:runId/artifacts/:id streams bytes for stored artifacts with metadata", async () => {
    const container = await createTestContainer();
    const app = createApp(container);
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-1",
      runId: "run-artifacts-1",
      stepId: "step-artifacts-1",
      attemptId: "attempt-artifacts-1",
    };
    await seedExecutionScope(container.db, scope);

    const ref = await container.artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("hello", "utf8"),
      labels: ["log"],
      metadata: { test: true },
    });

    await container.db.run(
      `INSERT INTO execution_artifacts (
         artifact_id,
         workspace_id,
         agent_id,
         run_id,
         step_id,
         attempt_id,
         kind,
         uri,
         created_at,
         mime_type,
         size_bytes,
         sha256,
         labels_json,
         metadata_json,
         sensitivity,
         policy_snapshot_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ref.artifact_id,
        "default",
        "agent-1",
        scope.runId,
        scope.stepId,
        scope.attemptId,
        ref.kind,
        ref.uri,
        ref.created_at,
        ref.mime_type ?? null,
        ref.size_bytes ?? null,
        ref.sha256 ?? null,
        JSON.stringify(ref.labels ?? []),
        JSON.stringify(ref.metadata ?? {}),
        "normal",
        null,
      ],
    );

    const metaRes = await app.request(`/runs/${scope.runId}/artifacts/${ref.artifact_id}/metadata`);
    expect(metaRes.status).toBe(200);
    const metaBody = (await metaRes.json()) as { artifact: { uri: string; kind: string } };
    expect(metaBody.artifact.uri).toBe(ref.uri);
    expect(metaBody.artifact.kind).toBe(ref.kind);

    const res = await app.request(`/runs/${scope.runId}/artifacts/${ref.artifact_id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("hello");

    await container.db.close();
  });

  it("GET /runs/:runId/artifacts/:id redirects to a signed URL when the store supports it", async () => {
    const container = await createTestContainer();
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-signed-url",
      runId: "run-artifacts-signed-url",
      stepId: "step-artifacts-signed-url",
      attemptId: "attempt-artifacts-signed-url",
    };
    await seedExecutionScope(container.db, scope);

    const ref = await container.artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("hello", "utf8"),
      labels: ["log"],
      metadata: { test: true },
    });

    await container.db.run(
      `INSERT INTO execution_artifacts (
         artifact_id,
         workspace_id,
         agent_id,
         run_id,
         step_id,
         attempt_id,
         kind,
         uri,
         created_at,
         mime_type,
         size_bytes,
         sha256,
         labels_json,
         metadata_json,
         sensitivity,
         policy_snapshot_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ref.artifact_id,
        "default",
        "agent-1",
        scope.runId,
        scope.stepId,
        scope.attemptId,
        ref.kind,
        ref.uri,
        ref.created_at,
        ref.mime_type ?? null,
        ref.size_bytes ?? null,
        ref.sha256 ?? null,
        JSON.stringify(ref.labels ?? []),
        JSON.stringify(ref.metadata ?? {}),
        "normal",
        null,
      ],
    );

    const signedUrl = `https://objects.example.test/${ref.artifact_id}?sig=test`;
    const put = container.artifactStore.put.bind(container.artifactStore);
    const get = vi.fn(container.artifactStore.get.bind(container.artifactStore));

    container.artifactStore = {
      put,
      get,
      getSignedUrl: vi.fn(async () => signedUrl),
    };

    const app = createApp(container);
    const res = await app.request(`/runs/${scope.runId}/artifacts/${ref.artifact_id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(signedUrl);
    expect(get).not.toHaveBeenCalled();

    await container.db.close();
  });

  it("GET /runs/:runId/artifacts/:id denies unlinked artifacts that lack durable execution scope", async () => {
    const container = await createTestContainer();
    const app = createApp(container);

    const ref = await container.artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("hello", "utf8"),
      labels: ["log"],
      metadata: { test: true },
    });

    await container.db.run(
      `INSERT INTO execution_artifacts (
         artifact_id,
         workspace_id,
         agent_id,
         run_id,
         step_id,
         attempt_id,
         kind,
         uri,
         created_at,
         mime_type,
         size_bytes,
         sha256,
         labels_json,
         metadata_json,
         sensitivity,
         policy_snapshot_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ref.artifact_id,
        "default",
        null,
        null,
        null,
        null,
        ref.kind,
        ref.uri,
        ref.created_at,
        ref.mime_type ?? null,
        ref.size_bytes ?? null,
        ref.sha256 ?? null,
        JSON.stringify(ref.labels ?? []),
        JSON.stringify(ref.metadata ?? {}),
        "normal",
        null,
      ],
    );

    const metaRes = await app.request(`/runs/run-does-not-matter/artifacts/${ref.artifact_id}/metadata`);
    expect(metaRes.status).toBe(403);

    const res = await app.request(`/runs/run-does-not-matter/artifacts/${ref.artifact_id}`);
    expect(res.status).toBe(403);

    await container.db.close();
  });

  it("GET /runs/:runId/artifacts/:id denies artifacts with inconsistent execution linkage", async () => {
    const container = await createTestContainer();
    const app = createApp(container);
    const scopeA: ExecutionScopeIds = {
      jobId: "job-artifacts-a",
      runId: "run-artifacts-a",
      stepId: "step-artifacts-a",
      attemptId: "attempt-artifacts-a",
    };
    const scopeB: ExecutionScopeIds = {
      jobId: "job-artifacts-b",
      runId: "run-artifacts-b",
      stepId: "step-artifacts-b",
      attemptId: "attempt-artifacts-b",
    };
    await seedExecutionScope(container.db, scopeA);
    await seedExecutionScope(container.db, scopeB);

    const ref = await container.artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("hello", "utf8"),
      labels: ["log"],
      metadata: { test: true },
    });

    await container.db.run(
      `INSERT INTO execution_artifacts (
         artifact_id,
         workspace_id,
         agent_id,
         run_id,
         step_id,
         attempt_id,
         kind,
         uri,
         created_at,
         mime_type,
         size_bytes,
         sha256,
         labels_json,
         metadata_json,
         sensitivity,
         policy_snapshot_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ref.artifact_id,
        "default",
        "agent-1",
        scopeA.runId,
        scopeB.stepId,
        scopeB.attemptId,
        ref.kind,
        ref.uri,
        ref.created_at,
        ref.mime_type ?? null,
        ref.size_bytes ?? null,
        ref.sha256 ?? null,
        JSON.stringify(ref.labels ?? []),
        JSON.stringify(ref.metadata ?? {}),
        "normal",
        null,
      ],
    );

    const metaRes = await app.request(`/runs/${scopeA.runId}/artifacts/${ref.artifact_id}/metadata`);
    expect(metaRes.status).toBe(403);

    const res = await app.request(`/runs/${scopeA.runId}/artifacts/${ref.artifact_id}`);
    expect(res.status).toBe(403);

    await container.db.close();
  });

  it("GET /runs/:runId/artifacts/:id denies scope mismatches (runId does not match artifact scope)", async () => {
    const container = await createTestContainer();
    const app = createApp(container);
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-scope",
      runId: "run-artifacts-scope",
      stepId: "step-artifacts-scope",
      attemptId: "attempt-artifacts-scope",
    };
    await seedExecutionScope(container.db, scope);

    const ref = await container.artifactStore.put({
      kind: "log",
      mime_type: "text/plain",
      body: Buffer.from("hello", "utf8"),
      labels: ["log"],
      metadata: { test: true },
    });

    await container.db.run(
      `INSERT INTO execution_artifacts (
         artifact_id,
         workspace_id,
         agent_id,
         run_id,
         step_id,
         attempt_id,
         kind,
         uri,
         created_at,
         mime_type,
         size_bytes,
         sha256,
         labels_json,
         metadata_json,
         sensitivity,
         policy_snapshot_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ref.artifact_id,
        "default",
        "agent-1",
        scope.runId,
        scope.stepId,
        scope.attemptId,
        ref.kind,
        ref.uri,
        ref.created_at,
        ref.mime_type ?? null,
        ref.size_bytes ?? null,
        ref.sha256 ?? null,
        JSON.stringify(ref.labels ?? []),
        JSON.stringify(ref.metadata ?? {}),
        "normal",
        null,
      ],
    );

    const metaRes = await app.request(`/runs/run-wrong-scope/artifacts/${ref.artifact_id}/metadata`);
    expect(metaRes.status).toBe(404);
    const metaBody = (await metaRes.json()) as { error: string; message: string };
    expect(metaBody).toEqual({ error: "not_found", message: "artifact not found" });

    const res = await app.request(`/runs/run-wrong-scope/artifacts/${ref.artifact_id}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; message: string };
    expect(body).toEqual({ error: "not_found", message: "artifact not found" });

    const missingMetaRes = await app.request(
      `/runs/${scope.runId}/artifacts/550e8400-e29b-41d4-a716-446655440000/metadata`,
    );
    expect(missingMetaRes.status).toBe(404);
    const missingMetaBody = (await missingMetaRes.json()) as { error: string; message: string };
    expect(missingMetaBody).toEqual(metaBody);

    const missingRes = await app.request(
      `/runs/${scope.runId}/artifacts/550e8400-e29b-41d4-a716-446655440000`,
    );
    expect(missingRes.status).toBe(404);
    const missingBody = (await missingRes.json()) as { error: string; message: string };
    expect(missingBody).toEqual(body);

    await container.db.close();
  });
});
