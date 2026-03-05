import { describe, expect, it } from "vitest";
import * as migrationAliases from "../../src/migration-aliases.js";

describe("migration-aliases exports", () => {
  it("does not export migrationIsApplied (dead code)", () => {
    expect("migrationIsApplied" in migrationAliases).toBe(false);
  });

  it("treats the pre-rebase approval engine action migration as an alias", () => {
    expect(
      migrationAliases.findAppliedMigrationAlias(
        "108_approval_engine_actions.sql",
        new Set(["106_approval_engine_actions.sql"]),
      ),
    ).toBe("106_approval_engine_actions.sql");
  });
});
