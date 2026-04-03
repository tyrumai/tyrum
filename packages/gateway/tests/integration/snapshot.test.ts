import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { ScheduleService } from "../../src/modules/automation/schedule-service.js";
import { ChannelConfigDal } from "../../src/modules/channels/channel-config-dal.js";
import { RoutingConfigDal } from "../../src/modules/channels/routing-config-dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("snapshot routes", () => {
  it("exports and imports a snapshot bundle (empty-db import)", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });

    const seededConversation = await container.conversationDal.getOrCreate({
      connectorKey: "telegram",
      providerThreadId: "thread-1",
      containerKind: "dm",
    });
    const approval = await container.approvalDal.create({
      tenantId: seededConversation.tenant_id,
      agentId: seededConversation.agent_id,
      workspaceId: seededConversation.workspace_id,
      approvalKey: "plan-1:0",
      prompt: "approve test",
      motivation: "Snapshot export should preserve approvals and their conversations.",
      kind: "policy",
      conversationId: seededConversation.conversation_id,
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

    const importedConversation = await container2.db.get<{ conversation_id: string }>(
      "SELECT conversation_id FROM conversations WHERE conversation_id = ?",
      [seededConversation.conversation_id],
    );
    expect(importedConversation?.conversation_id).toBe(seededConversation.conversation_id);

    const importedApproval = await container2.db.get<{ approval_id: string; prompt: string }>(
      "SELECT approval_id, prompt FROM approvals WHERE approval_id = ?",
      [approval.approval_id],
    );
    expect(importedApproval?.approval_id).toBe(approval.approval_id);
    expect(importedApproval?.prompt).toBe("approve test");

    const nextApproval = await container2.approvalDal.create({
      tenantId: seededConversation.tenant_id,
      agentId: seededConversation.agent_id,
      workspaceId: seededConversation.workspace_id,
      approvalKey: "plan-2:0",
      prompt: "next",
      motivation: "Snapshot import should keep approval inserts working afterward.",
      kind: "policy",
      conversationId: seededConversation.conversation_id,
    });
    expect(nextApproval.approval_id).not.toBe(approval.approval_id);

    await container.db.close();
    await container2.db.close();
  });

  it("imports snapshot bundles after pruning seeded default heartbeat schedules on the target", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });
    const sourceScheduleService = new ScheduleService(container.db, container.identityScopeDal);
    await sourceScheduleService.ensureDefaultHeartbeatScheduleForMembership({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      nowMs: Date.UTC(2026, 2, 6, 10, 0, 0),
    });

    const exportRes = await app.request("/snapshot/export");
    expect(exportRes.status).toBe(200);
    const bundle = (await exportRes.json()) as Record<string, unknown>;

    const { app: app2, container: container2 } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });
    const targetScheduleService = new ScheduleService(container2.db, container2.identityScopeDal);
    await targetScheduleService.ensureDefaultHeartbeatScheduleForMembership({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      nowMs: Date.UTC(2026, 2, 6, 10, 5, 0),
    });

    const targetWatcherCountBefore = await container2.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM watchers",
    );
    expect(targetWatcherCountBefore?.count).toBe(1);

    const importRes = await app2.request("/snapshot/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "IMPORT", bundle }),
    });
    expect(importRes.status).toBe(200);

    const targetWatcherCountAfter = await container2.db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM watchers",
    );
    expect(targetWatcherCountAfter?.count).toBe(1);

    const importedWatcher = await container2.db.get<{ watcher_key: string }>(
      "SELECT watcher_key FROM watchers LIMIT 1",
    );
    expect(importedWatcher?.watcher_key).toContain("schedule:default-heartbeat");

    await container.db.close();
    await container2.db.close();
  });

  it("imports approvals with guardian review history", async () => {
    const { app, container } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });

    const approval = await container.approvalDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      approvalKey: "snapshot-reviewed:0",
      prompt: "approve reviewed snapshot",
      motivation: "Snapshot import should preserve latest review references.",
      kind: "policy",
      status: "awaiting_human",
    });
    const resolved = await container.approvalDal.resolveWithEngineAction({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      decision: "approved",
      reason: "reviewed in source snapshot",
      resolvedBy: { kind: "test" },
    });
    expect(resolved?.transitioned).toBe(true);

    const exportRes = await app.request("/snapshot/export");
    expect(exportRes.status).toBe(200);
    const bundle = (await exportRes.json()) as Record<string, unknown>;
    const tables = bundle["tables"] as Record<string, { rows?: unknown[] }> | undefined;
    expect(tables?.["review_entries"]?.rows?.length).toBeGreaterThan(0);

    const { app: app2, container: container2 } = await createTestApp({
      deploymentConfig: { snapshots: { importEnabled: true } },
    });
    const importRes = await app2.request("/snapshot/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "IMPORT", bundle }),
    });
    expect(importRes.status).toBe(200);

    const importedApproval = await container2.approvalDal.getById({
      tenantId: DEFAULT_TENANT_ID,
      approvalId: approval.approval_id,
      includeReviews: true,
    });
    expect(importedApproval?.status).toBe("approved");
    expect(importedApproval?.latest_review).toMatchObject({
      reviewer_kind: "human",
      state: "approved",
      reason: "reviewed in source snapshot",
    });
    expect(importedApproval?.reviews).toHaveLength(1);

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

      await container.conversationDal.getOrCreate({
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

    await container.conversationDal.getOrCreate({
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
          accounts: {
            default: {
              default_agent_key: "default",
              threads: {
                "123": "agent-b",
              },
            },
          },
        },
      },
      reason: "snapshot-seed",
      createdBy: { kind: "test" },
    });
    await new ChannelConfigDal(container.db).createTelegram({
      tenantId: auth.tenantId,
      accountKey: "default",
      botToken: "snapshot-bot-token",
      webhookSecret: "snapshot-webhook-secret",
      allowedUserIds: ["123"],
      pipelineEnabled: false,
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
      telegram: {
        accounts: {
          default: {
            threads: { "123": "agent-b" },
          },
        },
      },
    });
    await expect(
      new ChannelConfigDal(container2.db).listTelegram(auth2.tenantId),
    ).resolves.toMatchObject([
      {
        channel: "telegram",
        account_key: "default",
        bot_token: "snapshot-bot-token",
        webhook_secret: "snapshot-webhook-secret",
        allowed_user_ids: ["123"],
        pipeline_enabled: false,
      },
    ]);

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
          artifacts: {
            included: true,
            has_retention_expires_at: true,
            has_bytes_deleted_at: true,
            has_bytes_deleted_reason: true,
          },
        },
      },
    });

    const tables = bundle["tables"] as Record<string, { columns?: unknown }> | undefined;
    const artifacts = tables?.["artifacts"];
    expect(artifacts?.columns).toEqual(
      expect.arrayContaining(["retention_expires_at", "bytes_deleted_at", "bytes_deleted_reason"]),
    );

    await container.db.close();
  });
});
