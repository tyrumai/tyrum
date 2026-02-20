import { describe, expect, it, beforeEach } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../../src/db.js";
import { migrate } from "../../src/migrate.js";
import { MemoryDal } from "../../src/modules/memory/dal.js";
import type Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function setupDb(): Database.Database {
  const db = createDatabase(":memory:");
  migrate(db, migrationsDir);
  return db;
}

describe("MemoryDal", () => {
  let db: Database.Database;
  let dal: MemoryDal;

  beforeEach(() => {
    db = setupDb();
    dal = new MemoryDal(db);
  });

  // --- Facts ---

  describe("facts", () => {
    it("inserts and retrieves a fact", () => {
      const id = dal.insertFact(
        "preferred_language",
        "TypeScript",
        "user_input",
        "2025-01-15T10:00:00Z",
        0.9,
      );
      expect(id).toBeGreaterThan(0);

      const facts = dal.getFacts();
      expect(facts).toHaveLength(1);
      expect(facts[0]!.fact_key).toBe("preferred_language");
      expect(facts[0]!.fact_value).toBe("TypeScript");
      expect(facts[0]!.confidence).toBe(0.9);
    });

    it("retrieves facts by key", () => {
      dal.insertFact(
        "name",
        "Alice",
        "profile",
        "2025-01-15T10:00:00Z",
        1.0,
      );
      dal.insertFact(
        "email",
        "alice@example.com",
        "profile",
        "2025-01-15T10:01:00Z",
        1.0,
      );
      dal.insertFact(
        "name",
        "Alice Smith",
        "updated_profile",
        "2025-01-16T10:00:00Z",
        0.95,
      );

      const namesFacts = dal.getFactsByKey("name");
      expect(namesFacts).toHaveLength(2);
      expect(namesFacts[0]!.fact_value).toBe("Alice Smith");
      expect(namesFacts[1]!.fact_value).toBe("Alice");
    });

    it("returns empty array when no facts exist", () => {
      const facts = dal.getFacts();
      expect(facts).toEqual([]);
    });
  });

  // --- Episodic Events ---

  describe("episodic events", () => {
    it("inserts and retrieves an episodic event", () => {
      const id = dal.insertEpisodicEvent(
        "evt-001",
        "2025-01-15T10:00:00Z",
        "web",
        "page_visit",
        { url: "https://example.com" },
      );
      expect(id).toBeGreaterThan(0);

      const events = dal.getEpisodicEvents();
      expect(events).toHaveLength(1);
      expect(events[0]!.event_id).toBe("evt-001");
      expect(events[0]!.payload).toEqual({ url: "https://example.com" });
    });

    it("rejects duplicate event_id", () => {
      dal.insertEpisodicEvent(
        "evt-dup",
        "2025-01-15T10:00:00Z",
        "web",
        "click",
        {},
      );

      expect(() =>
        dal.insertEpisodicEvent(
          "evt-dup",
          "2025-01-15T10:01:00Z",
          "web",
          "click",
          {},
        ),
      ).toThrow();
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        dal.insertEpisodicEvent(
          `evt-${String(i)}`,
          `2025-01-15T10:0${String(i)}:00Z`,
          "web",
          "action",
          { index: i },
        );
      }

      const limited = dal.getEpisodicEvents(3);
      expect(limited).toHaveLength(3);
    });
  });

  // --- Capability Memories ---

  describe("capability memories", () => {
    it("inserts a new capability memory", () => {
      const result = dal.upsertCapabilityMemory(
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

    it("updates existing capability memory and increments count", () => {
      dal.upsertCapabilityMemory(
        "web_login",
        "example.com",
        "playwright",
        { resultSummary: "First success" },
      );

      const result = dal.upsertCapabilityMemory(
        "web_login",
        "example.com",
        "playwright",
        { resultSummary: "Second success" },
      );

      expect(result.inserted).toBe(false);
      expect(result.successCount).toBe(2);
    });

    it("retrieves capability memories filtered by type", () => {
      dal.upsertCapabilityMemory(
        "web_login",
        "example.com",
        "playwright",
        {},
      );
      dal.upsertCapabilityMemory(
        "api_call",
        "weather_api",
        "http",
        {},
      );

      const webMemories = dal.getCapabilityMemories("web_login");
      expect(webMemories).toHaveLength(1);
      expect(webMemories[0]!.capability_type).toBe("web_login");

      const allMemories = dal.getCapabilityMemories();
      expect(allMemories).toHaveLength(2);
    });
  });

  // --- PAM Profiles ---

  describe("PAM profiles", () => {
    it("inserts and retrieves a PAM profile", () => {
      dal.upsertPamProfile("default", "v1", {
        autonomy_level: "supervised",
      });

      const profile = dal.getPamProfile("default");
      expect(profile).toBeDefined();
      expect(profile!.version).toBe("v1");
      expect(profile!.profile_data).toEqual({
        autonomy_level: "supervised",
      });
    });

    it("upserts an existing PAM profile", () => {
      dal.upsertPamProfile("default", "v1", {
        autonomy_level: "supervised",
      });
      dal.upsertPamProfile("default", "v2", {
        autonomy_level: "autonomous",
      });

      const profile = dal.getPamProfile("default");
      expect(profile!.version).toBe("v2");
      expect(profile!.profile_data).toEqual({
        autonomy_level: "autonomous",
      });
    });
  });

  // --- PVP Profiles ---

  describe("PVP profiles", () => {
    it("inserts and retrieves a PVP profile", () => {
      dal.upsertPvpProfile("persona-a", "v1", {
        tone: "formal",
        language: "en",
      });

      const profile = dal.getPvpProfile("persona-a");
      expect(profile).toBeDefined();
      expect(profile!.profile_data).toEqual({
        tone: "formal",
        language: "en",
      });
    });

    it("upserts an existing PVP profile", () => {
      dal.upsertPvpProfile("persona-a", "v1", {
        tone: "formal",
      });
      dal.upsertPvpProfile("persona-a", "v2", {
        tone: "casual",
      });

      const profile = dal.getPvpProfile("persona-a");
      expect(profile!.version).toBe("v2");
      expect(profile!.profile_data).toEqual({ tone: "casual" });
    });
  });
});
