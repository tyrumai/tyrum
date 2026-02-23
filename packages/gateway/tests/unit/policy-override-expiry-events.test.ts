import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ConnectionManager } from "../../src/ws/connection-manager.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { PolicyOverrideDal } from "../../src/modules/policy/override-dal.js";
import { createPolicyBundleRoutes } from "../../src/routes/policy-bundle.js";

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

  it("emits policy_override.expired once when stale overrides are expired", async () => {
    db = openTestSqliteDb();
    const policyOverrideDal = new PolicyOverrideDal(db);

    const override = await policyOverrideDal.create({
      agentId: "agent-1",
      workspaceId: "default",
      toolId: "tool.exec",
      pattern: "echo hi",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(override.status).toBe("active");

    const connectionManager = new ConnectionManager();
    const ws = createMockWs();
    connectionManager.addClient(ws as never, ["cli"]);

    const enqueue = vi.fn(async () => undefined);
    const app = new Hono();
    app.route(
      "/",
      createPolicyBundleRoutes({
        policyService: {} as never,
        policyOverrideDal,
        ws: {
          connectionManager,
          cluster: {
            edgeId: "edge-a",
            outboxDal: { enqueue } as never,
          },
        },
      }),
    );

    const res1 = await app.request("/policy/overrides");
    expect(res1.status).toBe(200);

    expect(ws.send).toHaveBeenCalledTimes(1);
    const evt1 = JSON.parse(String(ws.send.mock.calls[0]?.[0] ?? "{}")) as { type?: string; payload?: unknown };
    expect(evt1.type).toBe("policy_override.expired");
    expect(evt1.payload).toEqual(
      expect.objectContaining({
        override: expect.objectContaining({
          policy_override_id: override.policy_override_id,
          status: "expired",
        }),
      }),
    );
    expect(enqueue).toHaveBeenCalledTimes(1);

    const res2 = await app.request("/policy/overrides");
    expect(res2.status).toBe(200);

    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

