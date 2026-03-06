import { describe, expect, it } from "vitest";
import {
  resolveDefaultMigrationsDirForBaseDir,
  resolveGatewayMigrationsDir,
} from "../../src/bootstrap/config.js";

describe("resolveGatewayMigrationsDir", () => {
  it("uses the package migrations dir in source layout", () => {
    const resolved = resolveGatewayMigrationsDir(":memory:");

    expect(resolved).toMatch(/packages\/gateway\/migrations\/sqlite$/);
  });

  it("prefers ../../migrations for bundled bootstrap layout", () => {
    const resolved = resolveDefaultMigrationsDirForBaseDir(
      "/app/packages/gateway/dist/bootstrap",
      ":memory:",
      (path) => path === "/app/packages/gateway/migrations/sqlite",
    );

    expect(resolved).toBe("/app/packages/gateway/migrations/sqlite");
  });

  it("falls back to ../../migrations for source bootstrap layout", () => {
    const resolved = resolveDefaultMigrationsDirForBaseDir(
      "/app/packages/gateway/src/bootstrap",
      "postgres://example",
      (path) => path === "/app/packages/gateway/migrations/postgres",
    );

    expect(resolved).toBe("/app/packages/gateway/migrations/postgres");
  });

  it("falls back to the package migrations dir when neither bootstrap candidate exists", () => {
    const resolved = resolveDefaultMigrationsDirForBaseDir(
      "/app/packages/gateway/src/bootstrap",
      ":memory:",
      () => false,
    );

    expect(resolved).toBe("/app/packages/gateway/migrations/sqlite");
  });
});
