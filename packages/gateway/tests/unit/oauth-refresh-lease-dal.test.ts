import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { OauthRefreshLeaseDal } from "../../src/modules/oauth/refresh-lease-dal.js";

describe("OauthRefreshLeaseDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
  });

  it("does not allow re-entrant acquisition by the same owner before expiry", async () => {
    db = openTestSqliteDb();
    const leaseDal = new OauthRefreshLeaseDal(db);

    const acquiredFirst = await leaseDal.tryAcquire({
      profileId: "profile-1",
      owner: "instance-1",
      nowMs: 1_000,
      leaseTtlMs: 10,
    });
    expect(acquiredFirst).toBe(true);

    const acquiredSecond = await leaseDal.tryAcquire({
      profileId: "profile-1",
      owner: "instance-1",
      nowMs: 1_001,
      leaseTtlMs: 10,
    });
    expect(acquiredSecond).toBe(false);
  });

  it("allows acquisition after expiry", async () => {
    db = openTestSqliteDb();
    const leaseDal = new OauthRefreshLeaseDal(db);

    const acquiredFirst = await leaseDal.tryAcquire({
      profileId: "profile-1",
      owner: "instance-1",
      nowMs: 1_000,
      leaseTtlMs: 10,
    });
    expect(acquiredFirst).toBe(true);

    const acquiredBeforeExpiry = await leaseDal.tryAcquire({
      profileId: "profile-1",
      owner: "instance-2",
      nowMs: 1_009,
      leaseTtlMs: 10,
    });
    expect(acquiredBeforeExpiry).toBe(false);

    const acquiredAfterExpiry = await leaseDal.tryAcquire({
      profileId: "profile-1",
      owner: "instance-2",
      nowMs: 1_010,
      leaseTtlMs: 10,
    });
    expect(acquiredAfterExpiry).toBe(true);
  });
});
