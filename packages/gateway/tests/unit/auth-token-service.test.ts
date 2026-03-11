import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthTokenService } from "../../src/modules/auth/auth-token-service.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("AuthTokenService", () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = openTestSqliteDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("issues and authenticates a tenant-scoped admin token", async () => {
    const svc = new AuthTokenService(db);
    const issued = await svc.issueToken({
      tenantId: DEFAULT_TENANT_ID,
      role: "admin",
      scopes: ["*"],
    });

    expect(issued.token).toMatch(/^tyrum-token\.v1\./);
    const claims = await svc.authenticate(issued.token);
    expect(claims).toEqual(
      expect.objectContaining({
        token_kind: "admin",
        token_id: issued.row.token_id,
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: [],
      }),
    );
  });

  it("issues and authenticates a tenant-scoped device token with device binding", async () => {
    const svc = new AuthTokenService(db);
    const issued = await svc.issueToken({
      tenantId: DEFAULT_TENANT_ID,
      role: "client",
      deviceId: "dev_client_1",
      scopes: ["operator.read"],
      ttlSeconds: 300,
    });

    const claims = await svc.authenticate(issued.token);
    expect(claims).toEqual(
      expect.objectContaining({
        token_kind: "device",
        token_id: issued.row.token_id,
        tenant_id: DEFAULT_TENANT_ID,
        role: "client",
        device_id: "dev_client_1",
        scopes: ["operator.read"],
      }),
    );

    expect(await svc.authenticate(issued.token, { expectedDeviceId: "dev_client_2" })).toBeNull();
    expect(await svc.authenticate(issued.token, { expectedRole: "admin" })).toBeNull();
  });

  it("derives display names and supports in-place token updates", async () => {
    const svc = new AuthTokenService(db);
    const issued = await svc.issueToken({
      tenantId: DEFAULT_TENANT_ID,
      role: "client",
      deviceId: "dev_client_1",
      scopes: ["operator.read"],
    });

    expect(issued.row.display_name).toBe("dev_client_1");
    expect(issued.row.updated_at).toBe(issued.row.issued_at);

    const updated = await svc.updateToken({
      tokenId: issued.row.token_id,
      displayName: "Operator token",
      role: "admin",
      deviceId: null,
      scopes: ["operator.read", "operator.admin"],
      expiresAt: null,
    });

    expect(updated).toEqual(
      expect.objectContaining({
        token_id: issued.row.token_id,
        display_name: "Operator token",
        role: "admin",
        device_id: null,
        scopes_json: JSON.stringify([]),
      }),
    );

    const claims = await svc.authenticate(issued.token);
    expect(claims).toEqual(
      expect.objectContaining({
        token_kind: "admin",
        role: "admin",
        scopes: [],
      }),
    );
  });

  it("rejects malformed or unknown tokens", async () => {
    const svc = new AuthTokenService(db);
    expect(await svc.authenticate(undefined)).toBeNull();
    expect(await svc.authenticate("")).toBeNull();
    expect(await svc.authenticate("tyrum-token.v0.x.y")).toBeNull();
    expect(await svc.authenticate("not-a-token")).toBeNull();

    // Unknown token id.
    expect(await svc.authenticate("tyrum-token.v1.unknown.secret")).toBeNull();
  });

  it("rejects revoked and expired tokens", async () => {
    const svc = new AuthTokenService(db);
    const issued = await svc.issueToken({
      tenantId: DEFAULT_TENANT_ID,
      role: "client",
      deviceId: "dev_client_1",
      scopes: [],
      ttlSeconds: 1,
    });

    const expiresAt = issued.row.expires_at;
    expect(expiresAt).toBeTruthy();

    // Revoke path.
    expect(await svc.authenticate(issued.token)).not.toBeNull();
    expect(await svc.revokeToken(issued.row.token_id)).toBe(true);
    expect(await svc.authenticate(issued.token)).toBeNull();
    const revokedRow = await db.get<{ revoked_at: string | null; updated_at: string | null }>(
      `SELECT revoked_at, updated_at
       FROM auth_tokens
       WHERE token_id = ?`,
      [issued.row.token_id],
    );
    expect(revokedRow?.revoked_at).toBeTruthy();
    expect(revokedRow?.updated_at).toBe(revokedRow?.revoked_at);

    // Expiry path (new token).
    const issued2 = await svc.issueToken({
      tenantId: DEFAULT_TENANT_ID,
      role: "client",
      scopes: [],
      ttlSeconds: 1,
    });
    const expiresAt2 = issued2.row.expires_at;
    expect(expiresAt2).toBeTruthy();
    const expiredSvc = new AuthTokenService(db, {
      nowMs: () => Date.parse(expiresAt2!) + 1000,
    });
    expect(await expiredSvc.authenticate(issued2.token)).toBeNull();
  });

  it("authenticates provisioned opaque tenant admin tokens", async () => {
    const svc = new AuthTokenService(db, {
      provisionedTokens: [
        {
          token: "opaque-admin-token",
          tenantId: DEFAULT_TENANT_ID,
          role: "admin",
          scopes: ["*"],
          tokenId: "provisioned-default-tenant-admin",
        },
      ],
    });

    const claims = await svc.authenticate("opaque-admin-token");
    expect(claims).toEqual(
      expect.objectContaining({
        token_kind: "admin",
        token_id: "provisioned-default-tenant-admin",
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
        scopes: [],
      }),
    );
    expect(await svc.countActiveTenantAdminTokens(DEFAULT_TENANT_ID)).toBe(1);
  });

  it("rejects length-mismatched provisioned opaque tokens while preserving exact matches", async () => {
    const svc = new AuthTokenService(db, {
      provisionedTokens: [
        {
          token: "opaque-admin-token",
          tenantId: DEFAULT_TENANT_ID,
          role: "admin",
          scopes: ["*"],
        },
      ],
    });

    expect(await svc.authenticate("opaque-admin-token-extra")).toBeNull();
    expect(await svc.authenticate("opaque-admin-toke")).toBeNull();
    expect(await svc.authenticate("opaque-admin-token")).toEqual(
      expect.objectContaining({
        tenant_id: DEFAULT_TENANT_ID,
        role: "admin",
      }),
    );
  });

  it("continues scanning provisioned tokens after a role or device mismatch", async () => {
    const svc = new AuthTokenService(db, {
      provisionedTokens: [
        {
          token: "shared-token",
          tenantId: DEFAULT_TENANT_ID,
          role: "admin",
          scopes: ["*"],
          tokenId: "provisioned-admin",
        },
        {
          token: "shared-token",
          tenantId: DEFAULT_TENANT_ID,
          role: "client",
          deviceId: "device-2",
          scopes: ["operator.read"],
          tokenId: "provisioned-device",
        },
      ],
    });

    expect(
      await svc.authenticate("shared-token", {
        expectedRole: "client",
        expectedDeviceId: "device-2",
      }),
    ).toEqual(
      expect.objectContaining({
        token_id: "provisioned-device",
        role: "client",
        device_id: "device-2",
      }),
    );
  });
});
