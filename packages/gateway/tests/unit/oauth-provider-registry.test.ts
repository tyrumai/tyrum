import { afterEach, describe, expect, it } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { OAuthProviderRegistry } from "../../src/modules/oauth/provider-registry.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("OAuthProviderRegistry config defaults", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("defaults token_endpoint_basic_auth to false for public clients", async () => {
    db = openTestSqliteDb();
    await db.run(
      `INSERT INTO oauth_provider_configs (tenant_id, provider_id, client_id)
       VALUES (?, ?, ?)`,
      [DEFAULT_TENANT_ID, "public", "client-public"],
    );

    const registry = new OAuthProviderRegistry(db);
    const spec = await registry.get({ tenantId: DEFAULT_TENANT_ID, providerId: "public" });
    expect(spec?.token_endpoint_basic_auth).toBe(false);
  });

  it("defaults token_endpoint_basic_auth to false even when client_secret_key is configured", async () => {
    db = openTestSqliteDb();
    await db.run(
      `INSERT INTO oauth_provider_configs (tenant_id, provider_id, client_id, client_secret_key)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "confidential", "client-confidential", "secret-key-1"],
    );

    const registry = new OAuthProviderRegistry(db);
    const spec = await registry.get({ tenantId: DEFAULT_TENANT_ID, providerId: "confidential" });
    expect(spec?.token_endpoint_basic_auth).toBe(false);
    expect(spec?.client_secret_key).toBe("secret-key-1");
  });

  it("reports token_endpoint_basic_auth=true when configured", async () => {
    db = openTestSqliteDb();
    await db.run(
      `INSERT INTO oauth_provider_configs (tenant_id, provider_id, client_id, token_endpoint_basic_auth)
       VALUES (?, ?, ?, 1)`,
      [DEFAULT_TENANT_ID, "basic-auth", "client-basic"],
    );

    const registry = new OAuthProviderRegistry(db);
    const spec = await registry.get({ tenantId: DEFAULT_TENANT_ID, providerId: "basic-auth" });
    expect(spec?.token_endpoint_basic_auth).toBe(true);
  });
});
