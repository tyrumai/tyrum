import { describe, expect, it } from "vitest";
import { normalizeDbDateTime } from "../../src/utils/db-time.js";

describe("normalizeDbDateTime", () => {
  it("returns null for null", () => {
    expect(normalizeDbDateTime(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(normalizeDbDateTime(undefined)).toBeNull();
  });

  it("converts Date to ISO string", () => {
    const date = new Date("2026-01-15T10:30:00Z");
    expect(normalizeDbDateTime(date)).toBe("2026-01-15T10:30:00.000Z");
  });

  it("normalizes SQLite datetime format to ISO 8601", () => {
    expect(normalizeDbDateTime("2026-01-15 10:30:00")).toBe("2026-01-15T10:30:00Z");
  });

  it("passes through ISO 8601 strings unchanged", () => {
    expect(normalizeDbDateTime("2026-01-15T10:30:00Z")).toBe("2026-01-15T10:30:00Z");
  });

  it("passes through ISO 8601 strings with milliseconds unchanged", () => {
    expect(normalizeDbDateTime("2026-01-15T10:30:00.123Z")).toBe("2026-01-15T10:30:00.123Z");
  });

  it("passes through arbitrary strings unchanged", () => {
    expect(normalizeDbDateTime("not a date")).toBe("not a date");
  });
});
