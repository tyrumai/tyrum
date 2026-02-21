import { describe, it, expect, afterEach } from "vitest";
import { AuthProfileDal } from "../../src/modules/model/auth-profile-dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SqlDb } from "../../src/statestore/types.js";

describe("AuthProfileDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function createDal(): AuthProfileDal {
    db = openTestSqliteDb();
    return new AuthProfileDal(db);
  }

  it("creates a profile and returns all fields", async () => {
    const dal = createDal();
    const profile = await dal.create({
      profileId: "prof-1",
      provider: "openai",
      label: "GPT-4 Main",
      secretHandle: "secret://openai-key-1",
      priority: 10,
      metadata: { tier: "premium" },
    });

    expect(profile.profile_id).toBe("prof-1");
    expect(profile.provider).toBe("openai");
    expect(profile.label).toBe("GPT-4 Main");
    expect(profile.secret_handle).toBe("secret://openai-key-1");
    expect(profile.priority).toBe(10);
    expect(profile.is_active).toBe(true);
    expect(profile.last_used_at).toBeNull();
    expect(profile.failure_count).toBe(0);
    expect(profile.created_at).toBeTruthy();
    expect(profile.metadata).toEqual({ tier: "premium" });
  });

  it("creates a profile with minimal params", async () => {
    const dal = createDal();
    const profile = await dal.create({
      profileId: "prof-min",
      provider: "anthropic",
    });

    expect(profile.profile_id).toBe("prof-min");
    expect(profile.provider).toBe("anthropic");
    expect(profile.label).toBeNull();
    expect(profile.secret_handle).toBeNull();
    expect(profile.priority).toBe(0);
    expect(profile.is_active).toBe(true);
    expect(profile.metadata).toBeNull();
  });

  it("retrieves a profile by id", async () => {
    const dal = createDal();
    await dal.create({ profileId: "prof-1", provider: "openai" });

    const fetched = await dal.getById("prof-1");
    expect(fetched).toBeDefined();
    expect(fetched!.profile_id).toBe("prof-1");
    expect(fetched!.provider).toBe("openai");
  });

  it("returns undefined for non-existent profile id", async () => {
    const dal = createDal();
    expect(await dal.getById("does-not-exist")).toBeUndefined();
  });

  it("lists active profiles by provider sorted by priority and failure count", async () => {
    const dal = createDal();
    await dal.create({ profileId: "prof-low", provider: "openai", priority: 10 });
    await dal.create({ profileId: "prof-high", provider: "openai", priority: 1 });
    await dal.create({ profileId: "prof-other", provider: "anthropic", priority: 0 });

    const openaiProfiles = await dal.listByProvider("openai");
    expect(openaiProfiles).toHaveLength(2);
    expect(openaiProfiles[0]!.profile_id).toBe("prof-high");
    expect(openaiProfiles[1]!.profile_id).toBe("prof-low");

    const anthropicProfiles = await dal.listByProvider("anthropic");
    expect(anthropicProfiles).toHaveLength(1);
    expect(anthropicProfiles[0]!.profile_id).toBe("prof-other");
  });

  it("lists all profiles across providers", async () => {
    const dal = createDal();
    await dal.create({ profileId: "prof-1", provider: "openai" });
    await dal.create({ profileId: "prof-2", provider: "anthropic" });
    await dal.create({ profileId: "prof-3", provider: "openai", priority: 5 });

    const all = await dal.listAll();
    expect(all).toHaveLength(3);
  });

  it("recordFailure increments failure_count", async () => {
    const dal = createDal();
    await dal.create({ profileId: "prof-1", provider: "openai" });

    await dal.recordFailure("prof-1");
    const after1 = await dal.getById("prof-1");
    expect(after1!.failure_count).toBe(1);

    await dal.recordFailure("prof-1");
    const after2 = await dal.getById("prof-1");
    expect(after2!.failure_count).toBe(2);
  });

  it("resetFailures sets failure_count to 0", async () => {
    const dal = createDal();
    await dal.create({ profileId: "prof-1", provider: "openai" });
    await dal.recordFailure("prof-1");
    await dal.recordFailure("prof-1");

    await dal.resetFailures("prof-1");
    const profile = await dal.getById("prof-1");
    expect(profile!.failure_count).toBe(0);
  });

  it("recordUsage sets last_used_at", async () => {
    const dal = createDal();
    await dal.create({ profileId: "prof-1", provider: "openai" });

    const before = await dal.getById("prof-1");
    expect(before!.last_used_at).toBeNull();

    await dal.recordUsage("prof-1");

    const after = await dal.getById("prof-1");
    expect(after!.last_used_at).toBeTruthy();
  });

  it("deactivate sets is_active to false", async () => {
    const dal = createDal();
    await dal.create({ profileId: "prof-1", provider: "openai" });

    await dal.deactivate("prof-1");
    const profile = await dal.getById("prof-1");
    expect(profile!.is_active).toBe(false);
  });

  it("activate sets is_active to true", async () => {
    const dal = createDal();
    await dal.create({ profileId: "prof-1", provider: "openai" });
    await dal.deactivate("prof-1");

    await dal.activate("prof-1");
    const profile = await dal.getById("prof-1");
    expect(profile!.is_active).toBe(true);
  });

  it("deactivated profiles are excluded from listByProvider", async () => {
    const dal = createDal();
    await dal.create({ profileId: "prof-1", provider: "openai" });
    await dal.create({ profileId: "prof-2", provider: "openai" });
    await dal.deactivate("prof-1");

    const profiles = await dal.listByProvider("openai");
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.profile_id).toBe("prof-2");
  });

  it("normalizes created_at when Postgres returns Date", async () => {
    const createdAt = new Date("2024-06-15T12:00:00.000Z");
    const raw = {
      profile_id: "prof-pg",
      provider: "openai",
      label: null,
      secret_handle: null,
      priority: 0,
      is_active: 1,
      last_used_at: null,
      failure_count: 0,
      created_at: createdAt,
      metadata: null,
    };

    const stubDb: SqlDb = {
      kind: "postgres",
      get: async () => raw,
      all: async () => [],
      run: async () => ({ changes: 0 }),
      exec: async () => {},
      transaction: async (fn) => await fn(stubDb),
      close: async () => {},
    };

    const dal = new AuthProfileDal(stubDb);
    const fetched = await dal.getById("prof-pg");
    expect(fetched).toBeDefined();
    expect(fetched!.created_at).toBe(createdAt.toISOString());
  });
});
