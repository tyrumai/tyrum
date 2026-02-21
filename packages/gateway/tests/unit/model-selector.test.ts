import { describe, it, expect, afterEach } from "vitest";
import { AuthProfileDal } from "../../src/modules/model/auth-profile-dal.js";
import { ModelSelector } from "../../src/modules/model/selector.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("ModelSelector", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  function setup(): { dal: AuthProfileDal; selector: ModelSelector } {
    db = openTestSqliteDb();
    const dal = new AuthProfileDal(db);
    const selector = new ModelSelector(dal);
    return { dal, selector };
  }

  it("returns null when no profiles exist for a provider", async () => {
    const { selector } = setup();
    const result = await selector.select("openai");
    expect(result).toBeNull();
  });

  it("selects the highest priority (lowest number) profile", async () => {
    const { dal, selector } = setup();
    await dal.create({ profileId: "prof-low", provider: "openai", priority: 10 });
    await dal.create({ profileId: "prof-high", provider: "openai", priority: 1 });

    const result = await selector.select("openai");
    expect(result).not.toBeNull();
    expect(result!.profile.profile_id).toBe("prof-high");
    expect(result!.provider).toBe("openai");
  });

  it("pins selection to session", async () => {
    const { dal, selector } = setup();
    await dal.create({ profileId: "prof-1", provider: "openai", priority: 1 });
    await dal.create({ profileId: "prof-2", provider: "openai", priority: 2 });

    // First select pins prof-1 to session-A
    const first = await selector.select("openai", "session-A");
    expect(first!.profile.profile_id).toBe("prof-1");

    // Even if prof-1 has higher failure count now, session-A stays pinned
    await dal.recordFailure("prof-1");
    await dal.recordFailure("prof-1");
    const pinned = await selector.select("openai", "session-A");
    expect(pinned!.profile.profile_id).toBe("prof-1");
  });

  it("clears session pin when pinned profile is deactivated", async () => {
    const { dal, selector } = setup();
    await dal.create({ profileId: "prof-1", provider: "openai", priority: 1 });
    await dal.create({ profileId: "prof-2", provider: "openai", priority: 2 });

    // Pin prof-1 to session-A
    await selector.select("openai", "session-A");

    // Deactivate prof-1
    await dal.deactivate("prof-1");

    // Next select for session-A should pick prof-2
    const result = await selector.select("openai", "session-A");
    expect(result!.profile.profile_id).toBe("prof-2");
  });

  it("clearSessionPin removes the pin", async () => {
    const { dal, selector } = setup();
    await dal.create({ profileId: "prof-1", provider: "openai", priority: 1 });
    await dal.create({ profileId: "prof-2", provider: "openai", priority: 2 });

    // Pin to session
    await selector.select("openai", "session-A");
    // Clear pin
    selector.clearSessionPin("session-A");

    // Should do fresh selection (still picks prof-1 since it has highest priority)
    const result = await selector.select("openai", "session-A");
    expect(result!.profile.profile_id).toBe("prof-1");
  });

  it("failover skips the failed profile and picks next", async () => {
    const { dal, selector } = setup();
    await dal.create({ profileId: "prof-1", provider: "openai", priority: 1 });
    await dal.create({ profileId: "prof-2", provider: "openai", priority: 2 });

    const result = await selector.failover("prof-1", "openai");
    expect(result).not.toBeNull();
    expect(result!.profile.profile_id).toBe("prof-2");

    // Verify failure was recorded
    const prof1 = await dal.getById("prof-1");
    expect(prof1!.failure_count).toBe(1);
  });

  it("failover returns null when no other profiles exist", async () => {
    const { dal, selector } = setup();
    await dal.create({ profileId: "prof-1", provider: "openai", priority: 1 });

    const result = await selector.failover("prof-1", "openai");
    expect(result).toBeNull();
  });

  it("recordSuccess updates usage and resets failures", async () => {
    const { dal, selector } = setup();
    await dal.create({ profileId: "prof-1", provider: "openai" });
    await dal.recordFailure("prof-1");
    await dal.recordFailure("prof-1");

    await selector.recordSuccess("prof-1");

    const profile = await dal.getById("prof-1");
    expect(profile!.failure_count).toBe(0);
    expect(profile!.last_used_at).toBeTruthy();
  });
});
