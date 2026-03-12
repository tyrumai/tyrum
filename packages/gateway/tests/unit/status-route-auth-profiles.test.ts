import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { createStatusRoutes } from "../../src/routes/status.js";

describe("GET /status model_auth.auth_profiles", () => {
  let db: ReturnType<typeof openTestSqliteDb> | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("does not include legacy top-level auth_profiles", async () => {
    db = openTestSqliteDb();

    const routes = createStatusRoutes({
      version: "test-version",
      instanceId: "test-instance",
      role: "all",
      dbKind: "sqlite",
      db,
      isLocalOnly: true,
      otelEnabled: false,
      authEnabled: true,
      toolrunnerHardeningProfile: "baseline",
    });

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("authClaims", {
        token_kind: "admin",
        token_id: "token-1",
        tenant_id: "00000000-0000-0000-0000-000000000000",
        role: "admin",
        scopes: [],
      });
      return await next();
    });
    app.route("/", routes);

    const res = await app.request("/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["auth"]).toEqual({ enabled: true });
    expect("auth_profiles" in body).toBe(false);
    const modelAuth = body["model_auth"] as Record<string, unknown>;
    expect(modelAuth["auth_profiles"]).toBeTypeOf("object");
  });
});
