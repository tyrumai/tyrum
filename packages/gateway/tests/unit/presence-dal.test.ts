import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PresenceDal } from "../../src/modules/presence/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";

describe("PresenceDal", () => {
  let db: SqliteDb | undefined;
  const tenantOneId = "00000000-0000-4000-8000-00000000a101";
  const tenantTwoId = "00000000-0000-4000-8000-00000000a102";

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("flags malformed metadata_json and falls back to an empty object", async () => {
    db = openTestSqliteDb();
    const logger = { warn: vi.fn() };
    const metrics = new MetricsRegistry();
    const dal = new PresenceDal(db, { logger, metrics });

    await dal.upsert({
      tenantId: tenantOneId,
      instanceId: "presence-1",
      role: "gateway",
      metadata: { ok: true },
      nowMs: 1_700_000_000_000,
      ttlMs: 10_000,
    });

    await db.run(
      "UPDATE presence_entries SET metadata_json = ? WHERE tenant_id = ? AND instance_id = ?",
      ["{ not: json", tenantOneId, "presence-1"],
    );

    const row = await dal.getByInstanceId("presence-1", tenantOneId);
    expect(row?.metadata).toEqual({});
    expect(row?.tenant_id).toBe(tenantOneId);
    expect(logger.warn).toHaveBeenCalledWith(
      "persisted_json.read_failed",
      expect.objectContaining({
        table: "presence_entries",
        column: "metadata_json",
        reason: "invalid_json",
      }),
    );

    const metricsText = await metrics.registry.getSingleMetricAsString(
      "persisted_json_read_failures_total",
    );
    expect(metricsText).toContain(
      'table="presence_entries",column="metadata_json",reason="invalid_json"',
    );
  });

  it("rejects non-object metadata on write", async () => {
    db = openTestSqliteDb();
    const dal = new PresenceDal(db);

    await expect(
      dal.upsert({
        instanceId: "presence-invalid",
        role: "gateway",
        metadata: "not-an-object",
        nowMs: 1_700_000_000_000,
        ttlMs: 10_000,
      }),
    ).rejects.toThrow("presence_entries.metadata_json must be a JSON object");
  });

  it("rejects values that serialize to the wrong JSON shape", async () => {
    db = openTestSqliteDb();
    const dal = new PresenceDal(db);

    await expect(
      dal.upsert({
        instanceId: "presence-date",
        role: "gateway",
        metadata: new Date("2026-01-02T03:04:05.000Z"),
        nowMs: 1_700_000_000_000,
        ttlMs: 10_000,
      }),
    ).rejects.toThrow("presence_entries.metadata_json must serialize to a JSON object");
  });

  it("keeps the same instance_id isolated across tenants", async () => {
    db = openTestSqliteDb();
    const dal = new PresenceDal(db);
    const nowMs = 1_700_000_000_000;

    const tenantOneRow = await dal.upsert({
      tenantId: tenantOneId,
      instanceId: "shared-device",
      role: "client",
      connectionId: "conn-tenant-one",
      metadata: { tenant: 1 },
      nowMs,
      ttlMs: 10_000,
    });
    const tenantTwoRow = await dal.upsert({
      tenantId: tenantTwoId,
      instanceId: "shared-device",
      role: "client",
      connectionId: "conn-tenant-two",
      metadata: { tenant: 2 },
      nowMs,
      ttlMs: 10_000,
    });

    expect(tenantOneRow.tenant_id).toBe(tenantOneId);
    expect(tenantTwoRow.tenant_id).toBe(tenantTwoId);

    const rowsOne = await dal.listNonExpired(nowMs - 1, 200, tenantOneId);
    const rowsTwo = await dal.listNonExpired(nowMs - 1, 200, tenantTwoId);

    expect(rowsOne).toHaveLength(1);
    expect(rowsOne[0]?.tenant_id).toBe(tenantOneId);
    expect(rowsOne[0]?.instance_id).toBe("shared-device");
    expect(rowsOne[0]?.metadata).toEqual({ tenant: 1 });

    expect(rowsTwo).toHaveLength(1);
    expect(rowsTwo[0]?.tenant_id).toBe(tenantTwoId);
    expect(rowsTwo[0]?.instance_id).toBe("shared-device");
    expect(rowsTwo[0]?.metadata).toEqual({ tenant: 2 });

    expect(await dal.getByInstanceId("shared-device", tenantOneId)).toMatchObject({
      tenant_id: tenantOneId,
      instance_id: "shared-device",
    });
    expect(await dal.getByInstanceId("shared-device", tenantTwoId)).toMatchObject({
      tenant_id: tenantTwoId,
      instance_id: "shared-device",
    });
  });

  it("infers tenant_id from connection_id when it is omitted", async () => {
    db = openTestSqliteDb();
    const dal = new PresenceDal(db);
    const tenantId = "00000000-0000-4000-8000-00000000a103";
    const principalId = randomUUID();
    const connectionId = "conn-tenant-inferred";

    await db.run("INSERT INTO tenants (tenant_id, tenant_key) VALUES (?, ?)", [
      tenantId,
      "tenant-a",
    ]);
    await db.run(
      `INSERT INTO principals (
         tenant_id,
         principal_id,
         kind,
         principal_key,
         status,
         metadata_json
       ) VALUES (?, ?, 'client', ?, 'active', '{}')`,
      [tenantId, principalId, "device-a"],
    );
    await db.run(
      `INSERT INTO connections (
         tenant_id,
         connection_id,
         edge_id,
         principal_id,
         connected_at_ms,
         last_seen_at_ms,
         expires_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, connectionId, "edge-1", principalId, 1, 1, 10_000],
    );

    const row = await dal.upsert({
      instanceId: "beacon-device",
      role: "node",
      connectionId,
      metadata: { inferred: true },
      nowMs: 1_700_000_000_000,
      ttlMs: 10_000,
    });

    expect(row.tenant_id).toBe(tenantId);
    expect(await dal.getByInstanceId("beacon-device", tenantId)).toMatchObject({
      tenant_id: tenantId,
      instance_id: "beacon-device",
    });
  });
});
