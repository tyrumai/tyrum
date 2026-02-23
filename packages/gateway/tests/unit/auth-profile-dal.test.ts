import { describe, it, expect, afterEach } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";

describe("AuthProfileDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
  });

  it("includes expired OAuth profiles with refresh_token_handle in eligible list", async () => {
    db = openTestSqliteDb();
    const dal = new AuthProfileDal(db);

    const nowMs = Date.now();
    const expiredIso = new Date(nowMs - 5 * 60_000).toISOString();

    await dal.create({
      profileId: "p-refreshable",
      agentId: "agent-1",
      provider: "openai",
      type: "oauth",
      secretHandles: {
        access_token_handle: "access-1",
        refresh_token_handle: "refresh-1",
      },
      expiresAt: expiredIso,
      createdBy: { kind: "test" },
    });

    await dal.create({
      profileId: "p-expired-no-refresh",
      agentId: "agent-1",
      provider: "openai",
      type: "oauth",
      secretHandles: {
        access_token_handle: "access-2",
      },
      expiresAt: expiredIso,
      createdBy: { kind: "test" },
    });

    await dal.create({
      profileId: "p-expired-token",
      agentId: "agent-1",
      provider: "openai",
      type: "token",
      secretHandles: {
        token_handle: "token-1",
      },
      expiresAt: expiredIso,
      createdBy: { kind: "test" },
    });

    const eligible = await dal.listEligibleForProvider({
      agentId: "agent-1",
      provider: "openai",
      nowMs,
    });
    const ids = eligible.map((p) => p.profile_id);

    expect(ids).toContain("p-refreshable");
    expect(ids).not.toContain("p-expired-no-refresh");
    expect(ids).not.toContain("p-expired-token");
  });
});

