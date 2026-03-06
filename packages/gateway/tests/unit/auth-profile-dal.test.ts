import { describe, it, expect, afterEach, vi } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { AuthProfileDal } from "../../src/modules/models/auth-profile-dal.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

describe("AuthProfileDal", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
    vi.useRealTimers();
  });

  it("creates profiles and filters by status/provider", async () => {
    db = openTestSqliteDb();
    const dal = new AuthProfileDal(db);

    await db.run(
      `INSERT INTO secrets (tenant_id, secret_id, secret_key, status)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "00000000-0000-4000-8000-000000000101", "access-1", "active"],
    );
    await db.run(
      `INSERT INTO secrets (tenant_id, secret_id, secret_key, status)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "00000000-0000-4000-8000-000000000102", "refresh-1", "active"],
    );

    const p1 = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "p-refreshable",
      providerKey: "openai",
      type: "oauth",
      secretKeys: {
        access_token: "access-1",
        refresh_token: "refresh-1",
      },
    });
    expect(p1.secret_keys).toEqual({ access_token: "access-1", refresh_token: "refresh-1" });
    expect(p1.status).toBe("active");

    const p2 = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "p-disabled",
      providerKey: "openai",
      type: "oauth",
      secretKeys: {
        access_token: "access-1",
      },
    });
    await dal.disableByKey({ tenantId: DEFAULT_TENANT_ID, authProfileKey: p2.auth_profile_key });

    const eligible = await dal.list({
      tenantId: DEFAULT_TENANT_ID,
      providerKey: "openai",
      status: "active",
    });
    const keys = eligible.map((p) => p.auth_profile_key);
    expect(keys).toContain("p-refreshable");
    expect(keys).not.toContain("p-disabled");
  });

  it("changes updated_at only when the profile changes semantically", async () => {
    vi.useFakeTimers();
    db = openTestSqliteDb();
    const dal = new AuthProfileDal(db);

    vi.setSystemTime(new Date("2026-03-06T10:00:00.000Z"));
    const created = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "p-updated-at",
      providerKey: "openai",
      displayName: "Primary key",
      methodKey: "api_key",
      type: "api_key",
      config: { a: 1, b: 2 },
      labels: { env: "prod", tier: "gold" },
    });

    vi.setSystemTime(new Date("2026-03-06T11:00:00.000Z"));
    const noChange = await dal.updateByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: created.auth_profile_key,
      displayName: created.display_name,
      methodKey: created.method_key,
      config: { b: 2, a: 1 },
      labels: { tier: "gold", env: "prod" },
    });
    expect(noChange?.updated_at).toBe(created.updated_at);

    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));
    const changed = await dal.updateByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: created.auth_profile_key,
      displayName: "Primary key v2",
      methodKey: created.method_key,
      config: created.config,
      labels: created.labels,
    });

    expect(changed).toMatchObject({
      display_name: "Primary key v2",
      updated_at: "2026-03-06T12:00:00.000Z",
    });
  });

  it("keeps updated_at stable for repeated enable/disable no-ops", async () => {
    vi.useFakeTimers();
    db = openTestSqliteDb();
    const dal = new AuthProfileDal(db);

    vi.setSystemTime(new Date("2026-03-06T10:00:00.000Z"));
    const created = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "p-status-updated-at",
      providerKey: "openai",
      type: "api_key",
    });

    vi.setSystemTime(new Date("2026-03-06T11:00:00.000Z"));
    const repeatedEnable = await dal.enableByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: created.auth_profile_key,
    });
    expect(repeatedEnable).toMatchObject({
      status: "active",
      updated_at: created.updated_at,
    });

    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));
    const disabled = await dal.disableByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: created.auth_profile_key,
    });
    expect(disabled).toMatchObject({
      status: "disabled",
      updated_at: "2026-03-06T12:00:00.000Z",
    });

    vi.setSystemTime(new Date("2026-03-06T13:00:00.000Z"));
    const repeatedDisable = await dal.disableByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: created.auth_profile_key,
    });
    expect(repeatedDisable).toMatchObject({
      status: "disabled",
      updated_at: "2026-03-06T12:00:00.000Z",
    });

    vi.setSystemTime(new Date("2026-03-06T14:00:00.000Z"));
    const reenabled = await dal.enableByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: created.auth_profile_key,
    });
    expect(reenabled).toMatchObject({
      status: "active",
      updated_at: "2026-03-06T14:00:00.000Z",
    });
  });

  it("tracks updated_at when only the linked secrets change", async () => {
    vi.useFakeTimers();
    db = openTestSqliteDb();
    const dal = new AuthProfileDal(db);

    await db.run(
      `INSERT INTO secrets (tenant_id, secret_id, secret_key, status)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "00000000-0000-4000-8000-000000000201", "access-a", "active"],
    );
    await db.run(
      `INSERT INTO secrets (tenant_id, secret_id, secret_key, status)
       VALUES (?, ?, ?, ?)`,
      [DEFAULT_TENANT_ID, "00000000-0000-4000-8000-000000000202", "access-b", "active"],
    );

    vi.setSystemTime(new Date("2026-03-06T10:00:00.000Z"));
    const created = await dal.create({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: "p-secret-rotation",
      providerKey: "openai",
      type: "oauth",
      secretKeys: {
        access_token: "access-a",
      },
    });

    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));
    const rotated = await dal.updateByKey({
      tenantId: DEFAULT_TENANT_ID,
      authProfileKey: created.auth_profile_key,
      secretKeys: {
        access_token: "access-b",
      },
    });

    expect(rotated).toMatchObject({
      secret_keys: { access_token: "access-b" },
      updated_at: "2026-03-06T12:00:00.000Z",
    });
  });
});
