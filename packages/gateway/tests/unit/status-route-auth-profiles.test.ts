import { afterEach, describe, expect, it } from "vitest";
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

    const app = createStatusRoutes({
      version: "test-version",
      instanceId: "test-instance",
      role: "all",
      dbKind: "sqlite",
      db,
      isLocalOnly: true,
      otelEnabled: false,
    });

    const res = await app.request("/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect("auth_profiles" in body).toBe(false);
    const modelAuth = body["model_auth"] as Record<string, unknown>;
    expect(modelAuth["auth_profiles"]).toBeTypeOf("object");
  });
});
