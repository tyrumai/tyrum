import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryDal } from "../../src/modules/memory/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("MemoryDal", () => {
  let db: SqliteDb;
  let dal: MemoryDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    dal = new MemoryDal(db);
  });

  afterEach(async () => {
    await db.close();
  });

  // --- Facts ---

  describe("facts", () => {
    it("inserts and retrieves a fact", async () => {
      const id = await dal.insertFact(
        "preferred_language",
        "TypeScript",
        "user_input",
        "2025-01-15T10:00:00Z",
        0.9,
      );
      expect(id).toBeGreaterThan(0);

      const facts = await dal.getFacts();
      expect(facts).toHaveLength(1);
      expect(facts[0]!.fact_key).toBe("preferred_language");
      expect(facts[0]!.fact_value).toBe("TypeScript");
      expect(facts[0]!.confidence).toBe(0.9);
    });

    it("retrieves facts by key", async () => {
      await dal.insertFact(
        "name",
        "Alice",
        "profile",
        "2025-01-15T10:00:00Z",
        1.0,
      );
      await dal.insertFact(
        "email",
        "alice@example.com",
        "profile",
        "2025-01-15T10:01:00Z",
        1.0,
      );
      await dal.insertFact(
        "name",
        "Alice Smith",
        "updated_profile",
        "2025-01-16T10:00:00Z",
        0.95,
      );

      const namesFacts = await dal.getFactsByKey("name");
      expect(namesFacts).toHaveLength(2);
      expect(namesFacts[0]!.fact_value).toBe("Alice Smith");
      expect(namesFacts[1]!.fact_value).toBe("Alice");
    });

    it("returns empty array when no facts exist", async () => {
      const facts = await dal.getFacts();
      expect(facts).toEqual([]);
    });
  });

  // --- Episodic Events ---

  describe("episodic events", () => {
    it("inserts and retrieves an episodic event", async () => {
      const id = await dal.insertEpisodicEvent(
        "evt-001",
        "2025-01-15T10:00:00Z",
        "web",
        "page_visit",
        { url: "https://example.com" },
      );
      expect(id).toBeGreaterThan(0);

      const events = await dal.getEpisodicEvents();
      expect(events).toHaveLength(1);
      expect(events[0]!.event_id).toBe("evt-001");
      expect(events[0]!.payload).toEqual({ url: "https://example.com" });
    });

    it("dedupes duplicate event_id (idempotent insert)", async () => {
      const firstId = await dal.insertEpisodicEvent(
        "evt-dup",
        "2025-01-15T10:00:00Z",
        "web",
        "click",
        {},
      );

      const secondId = await dal.insertEpisodicEvent(
        "evt-dup",
        "2025-01-15T10:01:00Z",
        "web",
        "click",
        {},
      );

      expect(secondId).toBe(firstId);

      const events = await dal.getEpisodicEvents();
      expect(events).toHaveLength(1);
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await dal.insertEpisodicEvent(
          `evt-${String(i)}`,
          `2025-01-15T10:0${String(i)}:00Z`,
          "web",
          "action",
          { index: i },
        );
      }

      const limited = await dal.getEpisodicEvents(3);
      expect(limited).toHaveLength(3);
    });
  });

  // --- Capability Memories ---

  describe("capability memories", () => {
    it("inserts a new capability memory", async () => {
      const result = await dal.upsertCapabilityMemory(
        "web_login",
        "example.com",
        "playwright",
        {
          selectors: { username: "#user", password: "#pass" },
          resultSummary: "Login successful",
          lastSuccessAt: "2025-01-15T10:00:00Z",
        },
      );

      expect(result.inserted).toBe(true);
      expect(result.successCount).toBe(1);
    });

    it("updates existing capability memory and increments count", async () => {
      await dal.upsertCapabilityMemory(
        "web_login",
        "example.com",
        "playwright",
        { resultSummary: "First success" },
      );

      const result = await dal.upsertCapabilityMemory(
        "web_login",
        "example.com",
        "playwright",
        { resultSummary: "Second success" },
      );

      expect(result.inserted).toBe(false);
      expect(result.successCount).toBe(2);
    });

    it("retrieves capability memories filtered by type", async () => {
      await dal.upsertCapabilityMemory(
        "web_login",
        "example.com",
        "playwright",
        {},
      );
      await dal.upsertCapabilityMemory(
        "api_call",
        "weather_api",
        "http",
        {},
      );

      const webMemories = await dal.getCapabilityMemories("web_login");
      expect(webMemories).toHaveLength(1);
      expect(webMemories[0]!.capability_type).toBe("web_login");

      const allMemories = await dal.getCapabilityMemories();
      expect(allMemories).toHaveLength(2);
    });
  });

  // --- PAM Profiles ---

  describe("PAM profiles", () => {
    it("inserts and retrieves a PAM profile", async () => {
      await dal.upsertPamProfile("default", "v1", {
        autonomy_level: "supervised",
      });

      const profile = await dal.getPamProfile("default");
      expect(profile).toBeDefined();
      expect(profile!.version).toBe("v1");
      expect(profile!.profile_data).toEqual({
        autonomy_level: "supervised",
      });
    });

    it("upserts an existing PAM profile", async () => {
      await dal.upsertPamProfile("default", "v1", {
        autonomy_level: "supervised",
      });
      await dal.upsertPamProfile("default", "v2", {
        autonomy_level: "autonomous",
      });

      const profile = await dal.getPamProfile("default");
      expect(profile!.version).toBe("v2");
      expect(profile!.profile_data).toEqual({
        autonomy_level: "autonomous",
      });
    });
  });

  // --- PVP Profiles ---

  describe("PVP profiles", () => {
    it("inserts and retrieves a PVP profile", async () => {
      await dal.upsertPvpProfile("persona-a", "v1", {
        tone: "formal",
        language: "en",
      });

      const profile = await dal.getPvpProfile("persona-a");
      expect(profile).toBeDefined();
      expect(profile!.profile_data).toEqual({
        tone: "formal",
        language: "en",
      });
    });

    it("upserts an existing PVP profile", async () => {
      await dal.upsertPvpProfile("persona-a", "v1", {
        tone: "formal",
      });
      await dal.upsertPvpProfile("persona-a", "v2", {
        tone: "casual",
      });

      const profile = await dal.getPvpProfile("persona-a");
      expect(profile!.version).toBe("v2");
      expect(profile!.profile_data).toEqual({ tone: "casual" });
    });
  });
});
