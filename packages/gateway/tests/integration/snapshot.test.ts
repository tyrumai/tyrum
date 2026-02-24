import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("snapshot routes", () => {
  it("exports and imports a snapshot bundle (empty-db import)", async () => {
    const originalFlag = process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"];
    process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"] = "1";

    const { app, container } = await createTestApp();

    await container.db.run(
      `INSERT INTO sessions (session_id, channel, thread_id)
       VALUES (?, ?, ?)`,
      ["session-1", "telegram", "thread-1"],
    );
    const approval = await container.approvalDal.create({
      planId: "plan-1",
      stepIndex: 0,
      prompt: "approve test",
    });

    const exportRes = await app.request("/snapshot/export");
    expect(exportRes.status).toBe(200);
    const bundle = (await exportRes.json()) as Record<string, unknown>;

    const { app: app2, container: container2 } = await createTestApp();
    const importRes = await app2.request("/snapshot/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "IMPORT", bundle }),
    });
    expect(importRes.status).toBe(200);

    const importedSession = await container2.db.get<{ session_id: string }>(
      "SELECT session_id FROM sessions WHERE session_id = ?",
      ["session-1"],
    );
    expect(importedSession?.session_id).toBe("session-1");

    const importedApproval = await container2.db.get<{ id: number; prompt: string }>(
      "SELECT id, prompt FROM approvals WHERE id = ?",
      [approval.id],
    );
    expect(importedApproval?.id).toBe(approval.id);
    expect(importedApproval?.prompt).toBe("approve test");

    const nextApproval = await container2.approvalDal.create({
      planId: "plan-2",
      stepIndex: 0,
      prompt: "next",
    });
    expect(nextApproval.id).toBeGreaterThan(approval.id);

    await container.db.close();
    await container2.db.close();

    if (originalFlag === undefined) {
      delete process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"];
    } else {
      process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"] = originalFlag;
    }
  });

  it("includes routing config revisions in snapshot bundles", async () => {
    const originalFlag = process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"];
    process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"] = "1";

    const { app, container } = await createTestApp();

    const setRes = await app.request("/routing/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        config: {
          v: 1,
          telegram: {
            default_agent_id: "default",
            threads: {
              "123": "agent-b",
            },
          },
        },
        reason: "snapshot-seed",
      }),
    });
    expect(setRes.status).toBe(201);

    const exportRes = await app.request("/snapshot/export");
    expect(exportRes.status).toBe(200);
    const bundle = (await exportRes.json()) as Record<string, unknown>;

    const { app: app2, container: container2 } = await createTestApp();
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

    const fetchRes = await app2.request("/routing/config", { method: "GET" });
    expect(fetchRes.status).toBe(200);
    const fetchBody = (await fetchRes.json()) as { config: unknown };
    expect(fetchBody.config).toMatchObject({
      telegram: { threads: { "123": "agent-b" } },
    });

    await container.db.close();
    await container2.db.close();

    if (originalFlag === undefined) {
      delete process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"];
    } else {
      process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"] = originalFlag;
    }
  });
});
