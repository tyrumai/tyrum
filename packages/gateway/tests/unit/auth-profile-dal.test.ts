import { describe, it, expect, afterEach } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("AuthProfileDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
  });

  it("creates profiles and filters by status/provider", async () => {
    db = openTestSqliteDb();
    const dal = new AuthProfileDal(db);

    await db.run(
      `INSERT INTO secrets (tenant_id, secret_id, secret_key, status)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "00000000-0000-4000-8000-000000000101", "access-1", "active"],
    );
    await db.run(
      `INSERT INTO secrets (tenant_id, secret_id, secret_key, status)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "00000000-0000-4000-8000-000000000102", "refresh-1", "active"],
    );

    const p1 = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "p-refreshable",
      providerKey: "openai",
      type: "oauth",
      secretKeys: {
        access_token: "access-1",
        refresh_token: "refresh-1",
      },
    });
    expect(p1.secret_keys).toEqual({ access_token: "access-1", refresh_token: "refresh-1" });
    expect(p1.status).toBe("active");

    const p2 = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "p-disabled",
      providerKey: "openai",
      type: "oauth",
      secretKeys: {
        access_token: "access-1",
      },
    });
    await dal.disableByKey({ tenantId: DEFAULT_TENANT_ID, authProfileKey: p2.auth_profile_key });

    const eligible = await dal.list({
      tenantId: DEFAULT_TENANT_ID,
      providerKey: "openai",
      status: "active",
    });
    const keys = eligible.map((p) => p.auth_profile_key);
    expect(keys).toContain("p-refreshable");
    expect(keys).not.toContain("p-disabled");
  });
});
