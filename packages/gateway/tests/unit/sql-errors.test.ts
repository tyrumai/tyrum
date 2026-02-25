import { describe, expect, it } from "vitest";

describe("sql errors", () => {
  it("detects unique constraint violations across drivers", async () => {
    const mod: { isUniqueViolation?: (err: unknown) => boolean } | null =
      await import("../../src/utils/sql-errors.js").catch(() => null);

    expect(mod).not.toBeNull();
    expect(mod?.isUniqueViolation).toBeTypeOf("function");
    if (!mod?.isUniqueViolation) return;

    const { isUniqueViolation } = mod;

    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "SQLITE_CONSTRAINT" })).toBe(true);
    expect(isUniqueViolation({ code: "sqlite_constraint_unique" })).toBe(true);

    expect(isUniqueViolation({ code: "99999" })).toBe(false);
    expect(isUniqueViolation({})).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("nope")).toBe(false);
  });
});
