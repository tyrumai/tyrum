import { describe, expect, it } from "vitest";
import * as migrationAliases from "../../src/migration-aliases.js";

describe("migration-aliases exports", () => {
  it("does not export migrationIsApplied (dead code)", () => {
    expect("migrationIsApplied" in migrationAliases).toBe(false);
  });
});
