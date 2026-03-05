import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { RoutingConfigDal } from "../../src/modules/channels/routing-config-dal.js";

describe("snapshot routes", () => {
  it("exports and imports a snapshot bundle (empty-db import)", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });

    const seededSession = await container.sessionDal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-1",
      containerKind: "dm",
    });
    const approval = await container.approvalDal.create({
      tenantId: seededSession.tenant_id,
      agentId: seededSession.agent_id,
      workspaceId: seededSession.workspace_id,
      approvalKey: "plan-1:0",
      prompt: "approve test",
      sessionId: seededSession.session_id,
    });

    const exportRes = await app.request("/snapshot/export");
    expect(exportRes.status).toBe(200);
    const bundle = (await exportRes.json()) as Record<string, unknown>;

    const { app: app2, container: container2 } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });
    const importRes = await app2.request("/snapshot/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "IMPORT", bundle }),
    });
    expect(importRes.status).toBe(200);

    const importedSession = await container2.db.get<{ session_id: string }>(
      "SELECT session_id FROM sessions WHERE session_id = ?",
      [seededSession.session_id],
    );
    expect(importedSession?.session_id).toBe(seededSession.session_id);

    const importedApproval = await container2.db.get<{ approval_id: string; prompt: string }>(
      "SELECT approval_id, prompt FROM approvals WHERE approval_id = ?",
      [approval.approval_id],
    );
    expect(importedApproval?.approval_id).toBe(approval.approval_id);
    expect(importedApproval?.prompt).toBe("approve test");

    const nextApproval = await container2.approvalDal.create({
      tenantId: seededSession.tenant_id,
      agentId: seededSession.agent_id,
      workspaceId: seededSession.workspace_id,
      approvalKey: "plan-2:0",
      prompt: "next",
      sessionId: seededSession.session_id,
    });
    expect(nextApproval.approval_id).not.toBe(approval.approval_id);

    await container.db.close();
    await container2.db.close();
  });

  it("rejects snapshot bundles containing legacy v1 memory tables", async () => {
    let container: Awaited<ReturnType<typeof createTestApp>>["container"] | undefined;
    let container2: Awaited<ReturnType<typeof createTestApp>>["container"] | undefined;

    try {
      const app1 = await createTestApp({
        deploymentConfig: { snapshots: { importEnabled: true } },
      });
      container = app1.container;

      await container.sessionDal.getOrCreate({
        connectorKey: "telegram",
        providerThreadId: "thread-legacy",
        containerKind: "dm",
      });

      const exportRes = await app1.app.request("/snapshot/export");
      expect(exportRes.status).toBe(200);
      const bundle = (await exportRes.json()) as Record<string, unknown>;

      const tables = bundle["tables"] as Record<string, unknown> | undefined;
      if (!tables) throw new Error("expected snapshot export to include tables");

      const legacyEmptyTable = { columns: ["id"], rows: [] };
      tables["facts"] = legacyEmptyTable;
      tables["episodic_events"] = legacyEmptyTable;
      tables["capability_memories"] = legacyEmptyTable;
      tables["pam_profiles"] = legacyEmptyTable;
      tables["pvp_profiles"] = legacyEmptyTable;

      const app2 = await createTestApp({
        deploymentConfig: { snapshots: { importEnabled: true } },
      });
      container2 = app2.container;

      const importRes = await app2.app.request("/snapshot/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "IMPORT", bundle }),
      });
      expect(importRes.status).toBe(400);
      const importBody = (await importRes.json()) as Record<string, unknown>;
      expect(importBody["error"]).toBe("invalid_request");
      expect(String(importBody["message"])).toContain("unknown table");
    } finally {
      await container?.db.close();
      await container2?.db.close();
    }
  });

  it("rejects v1 snapshot bundles", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });

    await container.sessionDal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-v1",
      containerKind: "dm",
    });

    const exportRes = await app.request("/snapshot/export");
    expect(exportRes.status).toBe(200);
    const exported = (await exportRes.json()) as Record<string, unknown>;

    const bundle = { ...exported, format: "tyrum.snapshot.v1" } as Record<string, unknown>;
    delete bundle["artifacts"];

    const { app: app2, container: container2 } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });
    const importRes = await app2.request("/snapshot/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "IMPORT", bundle }),
    });
    expect(importRes.status).toBe(400);
    const importBody = (await importRes.json()) as Record<string, unknown>;
    expect(importBody["error"]).toBe("invalid_request");

    await container.db.close();
    await container2.db.close();
  });

  it("includes routing config revisions in snapshot bundles", async () => {
    const { app, container, auth } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });

    await new RoutingConfigDal(container.db).set({
      tenantId: auth.tenantId,
      config: {
        v: 1,
        telegram: {
          default_agent_key: "default",
          threads: {
            "123": "agent-b",
          },
        },
      },
      reason: "snapshot-seed",
      createdBy: { kind: "test" },
    });

    const exportRes = await app.request("/snapshot/export");
    expect(exportRes.status).toBe(200);
    const bundle = (await exportRes.json()) as Record<string, unknown>;

    const {
      app: app2,
      container: container2,
      auth: auth2,
    } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });
    const importRes = await app2.request("/snapshot/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "IMPORT", bundle }),
    });
    expect(importRes.status).toBe(200);

    const imported = await container2.db.get<{ revision: number }>(
      "SELECT revision FROM routing_configs ORDER BY revision DESC LIMIT 1",
    );
    expect(imported?.revision).toBeGreaterThan(0);

    const latest = await new RoutingConfigDal(container2.db).getLatest(auth2.tenantId);
    expect(latest?.config).toMatchObject({
      telegram: { threads: { "123": "agent-b" } },
    });

    await container.db.close();
    await container2.db.close();
  });

  it("declares artifact byte inclusion policy and retention metadata in snapshot bundles", async () => {
    const { app, container } = await createTestApp();

    const exportRes = await app.request("/snapshot/export");
    expect(exportRes.status).toBe(200);
    const bundle = (await exportRes.json()) as Record<string, unknown>;

    expect(bundle).toMatchObject({
      format: "tyrum.snapshot.v2",
      artifacts: {
        bytes: { included: false, included_sensitivity: [] },
        retention: {
          execution_artifacts: {
            included: true,
            has_retention_expires_at: true,
            has_bytes_deleted_at: true,
            has_bytes_deleted_reason: true,
          },
        },
      },
    });

    const tables = bundle["tables"] as Record<string, { columns?: unknown }> | undefined;
    const executionArtifacts = tables?.["execution_artifacts"];
    expect(executionArtifacts?.columns).toEqual(
      expect.arrayContaining(["retention_expires_at", "bytes_deleted_at", "bytes_deleted_reason"]),
    );

    await container.db.close();
  });
});
