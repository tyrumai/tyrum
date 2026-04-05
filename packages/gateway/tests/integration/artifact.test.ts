import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { S3ArtifactStore } from "../../src/modules/artifact/store.js";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createTestContainer } from "./helpers.js";
import {
  type ExecutionScopeIds,
  insertExecutionArtifactRecord,
  linkArtifactToExecution,
  putTextArtifact,
  seedExecutionScope,
  setupArtifactRouteTest,
} from "./artifact.test-support.js";

describe("artifact routes", () => {
  const publicBaseUrl = "https://gateway.example.test";
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

  it("GET /artifacts/:id/metadata returns stored metadata and artifact links", async () => {
    const { app, container, requestUnauthenticated, tenantAdminToken } =
      await setupArtifactRouteTest(homeDir);
    const ref = await putTextArtifact(container);
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-1",
      turnId: "run-artifacts-1",
      stepId: "step-artifacts-1",
      attemptId: "attempt-artifacts-1",
    };
    await seedExecutionScope(container.db, scope);
    await linkArtifactToExecution(container.db, ref, {
      turnId: scope.turnId,
      stepId: scope.stepId,
      attemptId: scope.attemptId,
    });

    const metaRes = await requestUnauthenticated(`/artifacts/${ref.artifact_id}/metadata`, {
      headers: {
        authorization: `Bearer ${tenantAdminToken}`,
      },
    });
    expect(metaRes.status).toBe(200);
    const metaBody = (await metaRes.json()) as {
      artifact: { artifact_id: string; external_url: string; uri: string };
      links: Array<{ parent_kind: string; parent_id: string }>;
    };
    expect(metaBody.artifact.artifact_id).toBe(ref.artifact_id);
    expect(metaBody.artifact.external_url).toBe(ref.external_url);
    expect(metaBody.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ parent_kind: "execution_run", parent_id: scope.turnId }),
        expect.objectContaining({
          parent_kind: "workflow_run_step",
          parent_id: scope.workflowRunStepId ?? scope.stepId,
        }),
      ]),
    );

    const res = await app.request(`/a/${ref.artifact_id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("hello");

    await container.db.close();
  });

  it("GET /a/:id streams bytes for stored artifacts", async () => {
    const { app, container } = await setupArtifactRouteTest(homeDir);
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-1",
      turnId: "run-artifacts-1",
      stepId: "step-artifacts-1",
      attemptId: "attempt-artifacts-1",
    };
    await seedExecutionScope(container.db, scope);
    const ref = await putTextArtifact(container);

    await linkArtifactToExecution(container.db, ref, {
      turnId: scope.turnId,
      stepId: scope.stepId,
      attemptId: scope.attemptId,
    });

    const res = await app.request(`/a/${ref.artifact_id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("hello");

    await container.db.close();
  });

  it("GET /a/:id requires authentication when auth middleware is enabled", async () => {
    const { container, requestUnauthenticated } = await setupArtifactRouteTest(homeDir);
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-auth-required",
      turnId: "run-artifacts-auth-required",
      stepId: "step-artifacts-auth-required",
      attemptId: "attempt-artifacts-auth-required",
    };
    await seedExecutionScope(container.db, scope);
    const ref = await putTextArtifact(container);

    await linkArtifactToExecution(container.db, ref, {
      turnId: scope.turnId,
      stepId: scope.stepId,
      attemptId: scope.attemptId,
    });

    const res = await requestUnauthenticated(`/a/${ref.artifact_id}`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "unauthorized",
      message: "Provide a valid token via Authorization: Bearer <token> header",
    });

    await container.db.close();
  });

  it("GET /a/:id is scoped to the authenticated tenant", async () => {
    const { container, requestUnauthenticated } = await setupArtifactRouteTest(homeDir);
    const otherTenantId = "11111111-1111-4111-8111-111111111111";
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-tenant-scope",
      turnId: "run-artifacts-tenant-scope",
      stepId: "step-artifacts-tenant-scope",
      attemptId: "attempt-artifacts-tenant-scope",
    };
    await seedExecutionScope(container.db, scope);
    const ref = await putTextArtifact(container);

    await linkArtifactToExecution(container.db, ref, {
      turnId: scope.turnId,
      stepId: scope.stepId,
      attemptId: scope.attemptId,
    });

    await container.db.run("INSERT INTO tenants (tenant_id, tenant_key) VALUES (?, ?)", [
      otherTenantId,
      "tenant-other",
    ]);
    const otherTenantToken = await new AuthTokenService(container.db).issueToken({
      tenantId: otherTenantId,
      role: "admin",
      scopes: ["*"],
    });
    const res = await requestUnauthenticated(`/a/${ref.artifact_id}`, {
      headers: {
        authorization: `Bearer ${otherTenantToken.token}`,
      },
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not_found",
      message: "artifact not found",
    });

    await container.db.close();
  });

  it("GET /a/:id emits artifact.fetched with requester identity and policy snapshot refs", async () => {
    const { container, requestUnauthenticated, tenantAdminToken } =
      await setupArtifactRouteTest(homeDir);
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-request-id",
      turnId: "run-artifacts-request-id",
      stepId: "step-artifacts-request-id",
      attemptId: "attempt-artifacts-request-id",
    };
    await seedExecutionScope(container.db, scope);
    const ref = await putTextArtifact(container);

    await container.db.run(
      `INSERT INTO policy_snapshots (tenant_id, policy_snapshot_id, sha256, bundle_json)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "ps-artifacts-request-id", "sha256-artifacts-request-id", "{}"],
    );
    await linkArtifactToExecution(container.db, ref, {
      turnId: scope.turnId,
      stepId: scope.stepId,
      attemptId: scope.attemptId,
      policySnapshotId: "ps-artifacts-request-id",
    });

    const requestId = "req-artifacts-123";
    const res = await requestUnauthenticated(`/a/${ref.artifact_id}`, {
      headers: {
        authorization: `Bearer ${tenantAdminToken}`,
        "x-request-id": requestId,
      },
    });
    expect(res.status).toBe(200);

    const outbox = await container.db.all<{ payload_json: string }>(
      "SELECT payload_json FROM outbox WHERE topic = ?",
      ["ws.broadcast"],
    );
    const fetched = outbox
      .map(
        (row) => JSON.parse(row.payload_json) as { message?: { type?: string; payload?: unknown } },
      )
      .map((row) => row.message)
      .find((message) => message?.type === "artifact.fetched");

    expect(fetched).toBeTruthy();
    expect(fetched?.payload).toMatchObject({
      policy_snapshot_id: "ps-artifacts-request-id",
      fetched_by: {
        kind: "http",
        request_id: requestId,
      },
    });

    await container.db.close();
  });

  it("GET /a/:id redirects to a signed URL when the store supports it", async () => {
    const container = await createTestContainer({
      deploymentConfig: {
        server: {
          publicBaseUrl,
        },
      },
    });
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-signed-url",
      turnId: "run-artifacts-signed-url",
      stepId: "step-artifacts-signed-url",
      attemptId: "attempt-artifacts-signed-url",
    };
    await seedExecutionScope(container.db, scope);
    const ref = await putTextArtifact(container);

    await linkArtifactToExecution(container.db, ref, {
      turnId: scope.turnId,
      stepId: scope.stepId,
      attemptId: scope.attemptId,
    });

    const signedUrl = `https://objects.example.test/${ref.artifact_id}?sig=test`;
    const put = container.artifactStore.put.bind(container.artifactStore);
    const get = vi.fn(container.artifactStore.get.bind(container.artifactStore));

    container.artifactStore = {
      put,
      get,
      getSignedUrl: vi.fn(async () => signedUrl),
    };

    const { app } = await setupArtifactRouteTest(homeDir, container);
    const res = await app.request(`/a/${ref.artifact_id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(signedUrl);
    expect(get).not.toHaveBeenCalled();

    await container.db.close();
  });

  it("GET /a/:id redirects using S3ArtifactStore instance (preserves this binding)", async () => {
    const container = await createTestContainer({
      deploymentConfig: {
        server: {
          publicBaseUrl,
        },
      },
    });
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-signed-url-s3-store",
      turnId: "run-artifacts-signed-url-s3-store",
      stepId: "step-artifacts-signed-url-s3-store",
      attemptId: "attempt-artifacts-signed-url-s3-store",
    };
    await seedExecutionScope(container.db, scope);

    const artifactId = "550e8400-e29b-41d4-a716-446655440000";
    const signedUrl = `https://objects.example.test/${artifactId}?sig=test`;
    const manifestKey = `artifacts/manifests/55/${artifactId}.json`;
    const blobKey = `artifacts/blobs/55/${artifactId}/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.bin`;

    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof GetObjectCommand) {
        const key = cmd.input.Key ?? "";
        if (key === manifestKey) {
          const meta = JSON.stringify({
            v: 1,
            ref: {
              artifact_id: artifactId,
              uri: `artifact://${artifactId}`,
              external_url: `${publicBaseUrl}/a/${artifactId}`,
              kind: "log",
              media_class: "document",
              created_at: "2026-02-19T12:00:00.000Z",
              filename: `artifact-${artifactId}.txt`,
              labels: [],
              sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
              size_bytes: 5,
              mime_type: "text/plain",
            },
            blob_key: blobKey,
          });
          return {
            Body: {
              transformToByteArray: async () => Buffer.from(meta, "utf8"),
            },
          };
        }
      }

      if (cmd instanceof HeadObjectCommand) {
        const key = cmd.input.Key ?? "";
        if (key === blobKey) return {};
      }

      throw new Error("unexpected command");
    });

    const store = new S3ArtifactStore(
      { send } as unknown as import("@aws-sdk/client-s3").S3Client,
      "bucket",
      "artifacts",
      undefined,
      publicBaseUrl,
      async () => signedUrl,
    );

    await insertExecutionArtifactRecord(container.db, {
      artifactId,
      kind: "log",
      uri: `artifact://${artifactId}`,
      externalUrl: `${publicBaseUrl}/a/${artifactId}`,
      mediaClass: "document",
      filename: `${artifactId}.txt`,
      createdAt: "2026-02-19T12:00:00.000Z",
      mimeType: "text/plain",
      sizeBytes: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      labels: [],
      metadata: {},
      turnId: scope.turnId,
      stepId: scope.stepId,
      attemptId: scope.attemptId,
    });

    container.artifactStore = store;

    const { app } = await setupArtifactRouteTest(homeDir, container);
    const res = await app.request(`/a/${artifactId}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(signedUrl);

    await container.db.close();
  });

  it("GET /a/:id rejects invalid artifact metadata even when a signed URL is available", async () => {
    const container = await createTestContainer({
      deploymentConfig: {
        server: {
          publicBaseUrl,
        },
      },
    });
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-signed-url-invalid-meta",
      turnId: "run-artifacts-signed-url-invalid-meta",
      stepId: "step-artifacts-signed-url-invalid-meta",
      attemptId: "attempt-artifacts-signed-url-invalid-meta",
    };
    await seedExecutionScope(container.db, scope);
    const ref = await putTextArtifact(container);

    await linkArtifactToExecution(container.db, ref, {
      turnId: scope.turnId,
      stepId: scope.stepId,
      attemptId: scope.attemptId,
      uri: "not-a-valid-artifact-uri",
    });

    const signedUrl = `https://objects.example.test/${ref.artifact_id}?sig=test`;
    const put = container.artifactStore.put.bind(container.artifactStore);
    const get = vi.fn(container.artifactStore.get.bind(container.artifactStore));

    container.artifactStore = {
      put,
      get,
      getSignedUrl: vi.fn(async () => signedUrl),
    };

    const { app } = await setupArtifactRouteTest(homeDir, container);
    const res = await app.request(`/a/${ref.artifact_id}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "invalid_state",
      message: "artifact metadata is invalid",
    });
    expect(get).not.toHaveBeenCalled();

    await container.db.close();
  });

  it("GET /artifacts/:id/metadata and GET /a/:id reject invalid ids cleanly", async () => {
    const { container, app, requestUnauthenticated, tenantAdminToken } =
      await setupArtifactRouteTest(homeDir);
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-scope",
      turnId: "run-artifacts-scope",
      stepId: "step-artifacts-scope",
      attemptId: "attempt-artifacts-scope",
    };
    await seedExecutionScope(container.db, scope);

    const ref = await putTextArtifact(container);

    await linkArtifactToExecution(container.db, ref, {
      turnId: scope.turnId,
      stepId: scope.stepId,
      attemptId: scope.attemptId,
    });

    const metaRes = await requestUnauthenticated(
      `/artifacts/550e8400-e29b-41d4-a716-446655440000/metadata`,
      {
        headers: {
          authorization: `Bearer ${tenantAdminToken}`,
        },
      },
    );
    expect(metaRes.status).toBe(404);
    const metaBody = (await metaRes.json()) as { error: string; message: string };
    expect(metaBody).toEqual({ error: "not_found", message: "artifact not found" });

    const res = await app.request(`/a/550e8400-e29b-41d4-a716-446655440000`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; message: string };
    expect(body).toEqual({ error: "not_found", message: "artifact not found" });

    const invalidMetaRes = await requestUnauthenticated(`/artifacts/not-a-uuid/metadata`, {
      headers: {
        authorization: `Bearer ${tenantAdminToken}`,
      },
    });
    expect(invalidMetaRes.status).toBe(400);
    const invalidRes = await app.request(`/a/not-a-uuid`);
    expect(invalidRes.status).toBe(400);

    await container.db.close();
  });

  it("GET /artifacts/:id/metadata rejects missing artifact metadata while preserving route shape", async () => {
    const { container, requestUnauthenticated, tenantAdminToken } =
      await setupArtifactRouteTest(homeDir);
    const scope: ExecutionScopeIds = {
      jobId: "job-artifacts-scope",
      turnId: "run-artifacts-scope",
      stepId: "step-artifacts-scope",
      attemptId: "attempt-artifacts-scope",
    };
    await seedExecutionScope(container.db, scope);

    const ref = await putTextArtifact(container);

    const metaRes = await requestUnauthenticated(`/artifacts/${ref.artifact_id}/metadata`, {
      headers: {
        authorization: `Bearer ${tenantAdminToken}`,
      },
    });
    expect(metaRes.status).toBe(404);
    const metaBody = (await metaRes.json()) as { error: string; message: string };
    expect(metaBody).toEqual({ error: "not_found", message: "artifact not found" });

    await container.db.close();
  });
});
