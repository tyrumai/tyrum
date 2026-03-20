import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { createPolicyBundleRoutes } from "../../src/routes/policy-bundle.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
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

function createAuthedApp(routes: Hono): Hono {
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
  return app;
}

describe("policy bundle routes", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("returns 400 for invalid override list query params", async () => {
    db = openTestSqliteDb();
    const app = createAuthedApp(
      createPolicyBundleRoutes({
        policyService: {
          loadEffectiveBundle: vi.fn(),
        } as never,
        policyOverrideDal: new PolicyOverrideDal(db),
      }),
    );

    const res = await app.request("/policy/overrides?limit=not-a-number");

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
  });

  it("returns 400 for invalid override create requests", async () => {
    db = openTestSqliteDb();
    const app = createAuthedApp(
      createPolicyBundleRoutes({
        policyService: {
          loadEffectiveBundle: vi.fn(),
        } as never,
        policyOverrideDal: new PolicyOverrideDal(db),
      }),
    );

    const res = await app.request("/policy/overrides", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: DEFAULT_AGENT_ID }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_request" });
  });

  it("creates dedicated routed tool overrides without generic node-dispatch validation", async () => {
    db = openTestSqliteDb();
    const app = createAuthedApp(
      createPolicyBundleRoutes({
        policyService: {
          loadEffectiveBundle: vi.fn(),
        } as never,
        policyOverrideDal: new PolicyOverrideDal(db),
      }),
    );

    const res = await app.request("/policy/overrides", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: DEFAULT_AGENT_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
        tool_id: "tool.desktop.act",
        pattern: "tool.desktop.act",
      }),
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      override: {
        tool_id: "tool.desktop.act",
        pattern: "tool.desktop.act",
      },
    });
  });

  it("broadcasts created override events when websocket delivery is configured", async () => {
    db = openTestSqliteDb();
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

    const app = createAuthedApp(
      createPolicyBundleRoutes({
        policyService: {
          loadEffectiveBundle: vi.fn(),
        } as never,
        policyOverrideDal: new PolicyOverrideDal(db),
        ws: {
          connectionManager,
        },
      }),
    );

    const res = await app.request("/policy/overrides", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "vitest",
      },
      body: JSON.stringify({
        agent_id: DEFAULT_AGENT_ID,
        workspace_id: DEFAULT_WORKSPACE_ID,
        tool_id: "bash",
        pattern: "echo hi",
      }),
    });

    expect(res.status).toBe(201);
    expect(ws.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(ws.send.mock.calls[0]?.[0] ?? "{}")) as {
      type?: string;
      payload?: { override?: { pattern?: string } };
    };
    expect(payload.type).toBe("policy_override.created");
    expect(payload.payload?.override?.pattern).toBe("echo hi");
  });

  it("returns 400 for invalid revoke requests and 404 for missing overrides", async () => {
    db = openTestSqliteDb();
    const app = createAuthedApp(
      createPolicyBundleRoutes({
        policyService: {
          loadEffectiveBundle: vi.fn(),
        } as never,
        policyOverrideDal: new PolicyOverrideDal(db),
      }),
    );

    const invalid = await app.request("/policy/overrides/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(400);

    const missing = await app.request("/policy/overrides/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy_override_id: "00000000-0000-4000-8000-000000000098" }),
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: "not_found" });
  });
});
