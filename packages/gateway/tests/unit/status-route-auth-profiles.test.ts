import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { createStatusRoutes } from "../../src/routes/status.js";

describe("GET /status legacy auth_profiles", () => {
  let db: ReturnType<typeof openTestSqliteDb> | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("does not call auth profile DAL list methods", async () => {
    db = openTestSqliteDb();

    const app = createStatusRoutes({
      version: "test-version",
      instanceId: "test-instance",
      role: "all",
      dbKind: "sqlite",
      db,
      isLocalOnly: true,
      otelEnabled: false,
      authProfileDal: {
        list: async () => {
          throw new Error("unexpected authProfileDal.list call");
        },
      } as unknown as import("../../src/modules/models/auth-profile-dal.js").AuthProfileDal,
      pinDal: {
        list: async () => {
          throw new Error("unexpected pinDal.list call");
        },
      } as unknown as import("../../src/modules/models/session-pin-dal.js").SessionProviderPinDal,
    });

    const res = await app.request("/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["auth_profiles"]).toBeTypeOf("object");
  });
});
