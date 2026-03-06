import { afterEach, describe, expect, it, vi } from "vitest";
import { PresenceDal } from "../../src/modules/presence/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";

describe("PresenceDal", () => {
  let db: SqliteDb | undefined;

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
      instanceId: "presence-1",
      role: "gateway",
      metadata: { ok: true },
      nowMs: 1_700_000_000_000,
      ttlMs: 10_000,
    });

    await db.run("UPDATE presence_entries SET metadata_json = ? WHERE instance_id = ?", [
      "{ not: json",
      "presence-1",
    ]);

    const row = await dal.getByInstanceId("presence-1");
    expect(row?.metadata).toEqual({});
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
});
