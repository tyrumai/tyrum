import { describe, expect, it } from "vitest";
import { findAppliedMigrationAlias } from "../../src/migration-aliases.js";

describe("migration aliases", () => {
  it("treats renamed migrations as already applied", () => {
    const applied = new Set(["108_default_tenant_guardrails.sql"]);

    expect(findAppliedMigrationAlias("109_default_tenant_guardrails.sql", applied)).toBe(
      "108_default_tenant_guardrails.sql",
    );
  });

  it("returns undefined when a renamed migration was not previously applied", () => {
    expect(
      findAppliedMigrationAlias("109_default_tenant_guardrails.sql", new Set()),
    ).toBeUndefined();
  });
});
