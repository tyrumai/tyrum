import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { OauthRefreshLeaseDal } from "../../src/modules/oauth/refresh-lease-dal.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("OauthRefreshLeaseDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
  });

  it("does not allow re-entrant acquisition by the same owner before expiry", async () => {
    db = openTestSqliteDb();
    const authProfiles = new AuthProfileDal(db);
    const leaseDal = new OauthRefreshLeaseDal(db);

    const profile = await authProfiles.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "profile-1",
      providerKey: "openai",
      type: "oauth",
    });

    const acquiredFirst = await leaseDal.tryAcquire({
      tenantId: DEFAULT_TENANT_ID,
      authProfileId: profile.auth_profile_id,
      owner: "instance-1",
      nowMs: 1_000,
      leaseTtlMs: 10,
    });
    expect(acquiredFirst).toBe(true);

    const acquiredSecond = await leaseDal.tryAcquire({
      tenantId: DEFAULT_TENANT_ID,
      authProfileId: profile.auth_profile_id,
      owner: "instance-1",
      nowMs: 1_001,
      leaseTtlMs: 10,
    });
    expect(acquiredSecond).toBe(false);
  });

  it("allows acquisition after expiry", async () => {
    db = openTestSqliteDb();
    const authProfiles = new AuthProfileDal(db);
    const leaseDal = new OauthRefreshLeaseDal(db);

    const profile = await authProfiles.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "profile-1",
      providerKey: "openai",
      type: "oauth",
    });

    const acquiredFirst = await leaseDal.tryAcquire({
      tenantId: DEFAULT_TENANT_ID,
      authProfileId: profile.auth_profile_id,
      owner: "instance-1",
      nowMs: 1_000,
      leaseTtlMs: 10,
    });
    expect(acquiredFirst).toBe(true);

    const acquiredBeforeExpiry = await leaseDal.tryAcquire({
      tenantId: DEFAULT_TENANT_ID,
      authProfileId: profile.auth_profile_id,
      owner: "instance-2",
      nowMs: 1_009,
      leaseTtlMs: 10,
    });
    expect(acquiredBeforeExpiry).toBe(false);

    const acquiredAfterExpiry = await leaseDal.tryAcquire({
      tenantId: DEFAULT_TENANT_ID,
      authProfileId: profile.auth_profile_id,
      owner: "instance-2",
      nowMs: 1_010,
      leaseTtlMs: 10,
    });
    expect(acquiredAfterExpiry).toBe(true);
  });
});
