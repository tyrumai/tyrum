import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { createPolicyBundleRoutes } from "../../src/routes/policy-bundle.js";
import { OutboxDal } from "../../src/modules/backplane/outbox-dal.js";
import { OutboxPoller } from "../../src/modules/backplane/outbox-poller.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  readyState: number;
}

function createMockWs(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(() => undefined as never),
    readyState: 1,
  };
}

describe("policy overrides expiry events", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("broadcasts policy_override.expired once when stale overrides are expired via /policy/overrides", async () => {
    db = openTestSqliteDb();
    const policyOverrideDal = new PolicyOverrideDal(db);

    const override = await policyOverrideDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      toolId: "tool.exec",
      pattern: "echo hi",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(override.status).toBe("active");

    const connectionManager = new ConnectionManager();
    const ws = createMockWs();
    connectionManager.addClient(ws as never, ["cli"], {
      authClaims: {
        token_kind: "device",
        token_id: "token-admin-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev-admin-1",
        scopes: ["operator.admin"],
      },
    });
    const approvalWs = createMockWs();
    connectionManager.addClient(approvalWs as never, ["cli"], {
      authClaims: {
        token_kind: "device",
        token_id: "token-approval-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev-approval-1",
        scopes: ["operator.approvals"],
      },
    });
    const nodeWs = createMockWs();
    connectionManager.addClient(nodeWs as never, ["cli"], {
      role: "node",
      authClaims: {
        token_kind: "device",
        token_id: "token-node-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "node",
        device_id: "dev-node-1",
        scopes: ["operator.admin"],
      },
    });

    const outboxDal = new OutboxDal(db);
    const outboxPoller = new OutboxPoller({
      consumerId: "edge-a",
      outboxDal,
      connectionManager,
    });

    const routes = createPolicyBundleRoutes({
      policyService: {} as never,
      policyOverrideDal,
    });

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "device",
        token_id: "token-admin-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev-admin-1",
        scopes: ["operator.admin"],
      });
      return await next();
    });
    app.route("/", routes);

    const res1 = await app.request("/policy/overrides");
    expect(res1.status).toBe(200);

    await outboxPoller.tick();
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(approvalWs.send).not.toHaveBeenCalled();
    expect(nodeWs.send).not.toHaveBeenCalled();

    const evt1 = JSON.parse(String(ws.send.mock.calls[0]?.[0] ?? "{}")) as {
      type?: string;
      payload?: unknown;
    };
    expect(evt1.type).toBe("policy_override.expired");
    expect(evt1.payload).toEqual(
      expect.objectContaining({
        override: expect.objectContaining({
          policy_override_id: override.policy_override_id,
          status: "expired",
        }),
      }),
    );

    const res2 = await app.request("/policy/overrides");
    expect(res2.status).toBe(200);

    await outboxPoller.tick();
    expect(ws.send).toHaveBeenCalledTimes(1);
  });

  it("broadcasts policy_override.expired when stale overrides are expired via policy evaluation path", async () => {
    db = openTestSqliteDb();
    const policyOverrideDal = new PolicyOverrideDal(db);

    const override = await policyOverrideDal.create({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      toolId: "tool.exec",
      pattern: "echo hi",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(override.status).toBe("active");

    const connectionManager = new ConnectionManager();
    const ws = createMockWs();
    connectionManager.addClient(ws as never, ["cli"], {
      authClaims: {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: ["*"],
      },
    });

    const outboxDal = new OutboxDal(db);
    const outboxPoller = new OutboxPoller({
      consumerId: "edge-a",
      outboxDal,
      connectionManager,
    });

    const active = await policyOverrideDal.listActiveForTool({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      toolId: "tool.exec",
    });
    expect(active).toEqual([]);

    await outboxPoller.tick();
    expect(ws.send).toHaveBeenCalledTimes(1);
    const evt1 = JSON.parse(String(ws.send.mock.calls[0]?.[0] ?? "{}")) as { type?: string };
    expect(evt1.type).toBe("policy_override.expired");
  });
});
