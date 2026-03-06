import { describe, expect, it } from "vitest";
import * as migrationAliases from "../../src/migration-aliases.js";

describe("migration-aliases exports", () => {
  it("does not export migrationIsApplied (dead code)", () => {
    expect("migrationIsApplied" in migrationAliases).toBe(false);
  });

  it("treats the pre-rebase approval engine action migration names as aliases", () => {
    expect(
      migrationAliases.findAppliedMigrationAlias(
        "110_approval_engine_actions.sql",
        new Set(["106_approval_engine_actions.sql"]),
      ),
    ).toBe("106_approval_engine_actions.sql");
    expect(
      migrationAliases.findAppliedMigrationAlias(
        "110_approval_engine_actions.sql",
        new Set(["108_approval_engine_actions.sql"]),
      ),
    ).toBe("108_approval_engine_actions.sql");
    expect(
      migrationAliases.findAppliedMigrationAlias(
        "110_approval_engine_actions.sql",
        new Set(["109_approval_engine_actions.sql"]),
      ),
    ).toBe("109_approval_engine_actions.sql");
  });

  it("exports the ws-events migration alias", () => {
    expect(
      migrationAliases.findAppliedMigrationAlias(
        "117_ws_events.sql",
        new Set(["116_ws_events.sql"]),
      ),
    ).toBe("116_ws_events.sql");
  });
});
