import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestApp } from "./helpers.js";
import { TokenStore } from "../../src/modules/auth/token-store.js";
import { GATEWAY_AUTH_AUDIT_PLAN_ID } from "../../src/modules/auth/audit.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("Auth audit request_id correlation", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-auth-audit-request-id-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists generated request_id for auth.failed when x-request-id is missing", async () => {
    const tokenStore = new TokenStore(tempDir);
    await tokenStore.initialize();

    const { app, container } = await createTestApp({ tokenStore, isLocalOnly: false });
    try {
      const res = await app.request("/status");
      expect(res.status).toBe(401);
      const requestId = res.headers.get("x-request-id");
      expect(requestId).toMatch(/^req-/);

      const rows = await container.db.all<{ action_json: string }>(
        `SELECT e.action_json
         FROM planner_events e
         JOIN plans p
           ON p.tenant_id = e.tenant_id AND p.plan_id = e.plan_id
         WHERE p.tenant_id = ? AND p.plan_key = ?
         ORDER BY e.step_index ASC`,
        [DEFAULT_TENANT_ID, GATEWAY_AUTH_AUDIT_PLAN_ID],
      );
      const actions = rows.map((row) => JSON.parse(row.action_json) as Record<string, unknown>);
      const authFailed = actions.find((action) => action["type"] === "auth.failed");
      expect(authFailed).toBeDefined();
      expect(authFailed!["request_id"]).toBe(requestId);
    } finally {
      await container.db.close();
    }
  });

  it("persists generated request_id for authz.denied when x-request-id is missing", async () => {
    const tokenStore = new TokenStore(tempDir);
    await tokenStore.initialize();

    const issued = await tokenStore.issueDeviceToken({
      deviceId: "dev_client_1",
      role: "client",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });

    const { app, container } = await createTestApp({ tokenStore, isLocalOnly: false });
    try {
      const res = await app.request("/watchers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${issued.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          plan_id: "plan-1",
          trigger_type: "periodic",
          trigger_config: { intervalMs: 1000 },
        }),
      });
      expect(res.status).toBe(403);
      const requestId = res.headers.get("x-request-id");
      expect(requestId).toMatch(/^req-/);

      const rows = await container.db.all<{ action_json: string }>(
        `SELECT e.action_json
         FROM planner_events e
         JOIN plans p
           ON p.tenant_id = e.tenant_id AND p.plan_id = e.plan_id
         WHERE p.tenant_id = ? AND p.plan_key = ?
         ORDER BY e.step_index ASC`,
        [DEFAULT_TENANT_ID, GATEWAY_AUTH_AUDIT_PLAN_ID],
      );
      const actions = rows.map((row) => JSON.parse(row.action_json) as Record<string, unknown>);
      const authzDenied = actions.find((action) => action["type"] === "authz.denied");
      expect(authzDenied).toBeDefined();
      expect(authzDenied!["request_id"]).toBe(requestId);
    } finally {
      await container.db.close();
    }
  });
});
