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

  it("treats rebased provider-model-config migrations as already applied", () => {
    expect(
      findAppliedMigrationAlias(
        "113_provider_model_config.sql",
        new Set(["108_provider_model_config.sql"]),
      ),
    ).toBe("108_provider_model_config.sql");
    expect(
      findAppliedMigrationAlias(
        "114_provider_model_config_indexes.sql",
        new Set(["109_provider_model_config_indexes.sql"]),
      ),
    ).toBe("109_provider_model_config_indexes.sql");
  });
});
