import { describe, expect, it, vi } from "vitest";
import { AuthTokenDal } from "../../src/modules/auth/auth-token-dal.js";
import type { SqlDb } from "../../src/statestore/types.js";

describe("AuthTokenDal", () => {
  it("lists tenant token metadata without selecting secret material", async () => {
    const all = vi.fn(async () => [
      {
        token_id: "token-1",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Admin token",
        role: "admin",
        device_id: null,
        scopes_json: JSON.stringify(["*"]),
        issued_at: "2026-03-01T00:00:00.000Z",
        expires_at: null,
        revoked_at: null,
        created_by_json: "{}",
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
      },
    ]);
    const db = {
      kind: "sqlite",
      all,
    } as unknown as SqlDb;

    const dal = new AuthTokenDal(db);
    const rows = await dal.listForTenant("11111111-1111-4111-8111-111111111111");

    expect(rows).toEqual([
      {
        token_id: "token-1",
        tenant_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Admin token",
        role: "admin",
        device_id: null,
        scopes_json: JSON.stringify(["*"]),
        issued_at: "2026-03-01T00:00:00.000Z",
        expires_at: null,
        revoked_at: null,
        created_by_json: "{}",
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
      },
    ]);

    const sql = all.mock.calls[0]?.[0] as string | undefined;
    expect(sql).toContain("SELECT");
    expect(sql).not.toContain("secret_salt");
    expect(sql).not.toContain("secret_hash");
    expect(sql).not.toContain("kdf");
  });

  it("updates updated_at when revoking a token", async () => {
    const get = vi.fn(async () => ({ token_id: "token-1" }));
    const db = {
      kind: "sqlite",
      get,
    } as unknown as SqlDb;

    const dal = new AuthTokenDal(db);
    const nowIso = "2026-03-11T12:00:00.000Z";

    await expect(dal.revoke("token-1", nowIso)).resolves.toBe(true);

    const sql = get.mock.calls[0]?.[0] as string | undefined;
    const params = get.mock.calls[0]?.[1] as unknown[] | undefined;
    expect(sql).toContain("SET revoked_at = ?,");
    expect(sql).toContain("updated_at = ?");
    expect(params).toEqual([nowIso, nowIso, "token-1"]);
  });
});
