import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createRoutingConfigRoutes } from "../../src/routes/routing-config.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { RoutingConfigDal } from "../../src/modules/channels/routing-config-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("routing config routes", () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = openTestSqliteDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("persists routing config revisions and emits ws events", async () => {
    const send = vi.fn();
    const app = new Hono();

    const routing = new RoutingConfigDal(db);
    app.route(
      "/",
      createRoutingConfigRoutes({
        routingConfigDal: routing,
        ws: {
          connectionManager: {
            allClients: () => [
              {
                role: "client",
                auth_claims: { token_kind: "admin", role: "admin", scopes: ["*"] },
                ws: { send },
              },
            ],
          },
        },
      } as never),
    );

    const res = await app.request("/routing/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          v: 1,
          telegram: {
            default_agent_key: "default",
            threads: {
              "123": "agent-b",
            },
          },
        },
        reason: "seed",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { revision: number; config: unknown };
    expect(body.revision).toBeGreaterThan(0);
    expect(body.config).toMatchObject({
      telegram: { threads: { "123": "agent-b" } },
    });

    const fetchRes = await app.request("/routing/config", { method: "GET" });
    expect(fetchRes.status).toBe(200);
    const fetched = (await fetchRes.json()) as { revision: number; config: unknown };
    expect(fetched.revision).toBe(body.revision);

    expect(send).toHaveBeenCalled();
    const payload = send.mock.calls[0]?.[0];
    expect(typeof payload).toBe("string");
    const evt = JSON.parse(String(payload)) as { type?: string; payload?: unknown };
    expect(evt.type).toBe("routing.config.updated");
    expect(evt.payload).toMatchObject({ revision: body.revision, reason: "seed" });
    expect(evt.payload as Record<string, unknown>).not.toHaveProperty("config");
  });

  it("reverts to an earlier revision", async () => {
    const send = vi.fn();
    const app = new Hono();

    const routing = new RoutingConfigDal(db);
    app.route(
      "/",
      createRoutingConfigRoutes({
        routingConfigDal: routing,
        ws: {
          connectionManager: {
            allClients: () => [
              {
                role: "client",
                auth_claims: { token_kind: "admin", role: "admin", scopes: ["*"] },
                ws: { send },
              },
            ],
          },
        },
      } as never),
    );

    const created = await app.request("/routing/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          v: 1,
          telegram: {
            default_agent_key: "default",
            threads: {
              "123": "agent-b",
            },
          },
        },
        reason: "seed",
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { revision: number; config: unknown };

    const updated = await app.request("/routing/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: { v: 1 },
        reason: "blank",
      }),
    });
    expect(updated.status).toBe(201);

    const reverted = await app.request("/routing/config/revert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: createdBody.revision, reason: "rollback" }),
    });

    expect(reverted.status).toBe(201);
    const revertedBody = (await reverted.json()) as { revision: number; config: unknown };
    expect(revertedBody.revision).toBeGreaterThan(createdBody.revision);
    expect(revertedBody.config).toEqual(createdBody.config);

    const latest = await app.request("/routing/config", { method: "GET" });
    expect(latest.status).toBe(200);
    await expect(latest.json()).resolves.toMatchObject({
      revision: revertedBody.revision,
      reverted_from_revision: createdBody.revision,
    });

    const audit = await db.all<{ action_json: string }>(
      `SELECT pe.action_json
       FROM planner_events pe
       JOIN plans p
         ON p.tenant_id = pe.tenant_id
        AND p.plan_id = pe.plan_id
       WHERE pe.tenant_id = ?
         AND p.plan_key = ?
       ORDER BY pe.step_index ASC`,
      [DEFAULT_TENANT_ID, "routing.config"],
    );
    expect(audit).toHaveLength(3);
    const action = JSON.parse(audit[2]!.action_json) as Record<string, unknown>;
    expect(action).toMatchObject({
      type: "routing.config.updated",
      revision: revertedBody.revision,
      reverted_from_revision: createdBody.revision,
    });
  });

  it("returns a structured error when the durable routing config state is corrupt", async () => {
    await db.run(
      "INSERT INTO routing_configs (config_json, created_by_json, reason) VALUES (?, ?, ?)",
      ["not-json", "{}", "corrupt"],
    );

    const app = new Hono();
    app.route(
      "/",
      createRoutingConfigRoutes({
        routingConfigDal: new RoutingConfigDal(db),
      } as never),
    );

    const res = await app.request("/routing/config", { method: "GET" });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "corrupt_state" });
  });
});
