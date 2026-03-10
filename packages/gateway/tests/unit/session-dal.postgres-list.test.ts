import { describe, expect, it, vi } from "vitest";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import { openTestPostgresDb } from "../helpers/postgres-db.js";
import { MetricsRegistry } from "../../src/modules/observability/metrics.js";

describe("SessionDal.list (postgres)", () => {
  it("treats malformed transcript_json as empty instead of failing the whole query", async () => {
    const { db, close } = await openTestPostgresDb();
    try {
      const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
      const channelThreadDal = new ChannelThreadDal(db);
      const logger = { warn: vi.fn() };
      const metrics = new MetricsRegistry();
      const dal = new SessionDal(db, identityScopeDal, channelThreadDal, { logger, metrics });
      const s1 = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-1",
        containerKind: "group",
      });
      const s2 = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-2",
        containerKind: "group",
      });

      await db.run(
        "UPDATE sessions SET transcript_json = ? WHERE tenant_id = ? AND session_id = ?",
        ["{ not: json", s1.tenant_id, s1.session_id],
      );

      const page = await dal.list({ connectorKey: "ui", limit: 10 });
      expect(page.sessions.map((s) => s.session_id).toSorted()).toEqual(
        [s1.session_key, s2.session_key].toSorted(),
      );

      const corrupted = page.sessions.find((s) => s.session_id === s1.session_key);
      expect(corrupted?.transcript_count).toBe(0);
      expect(corrupted?.last_text).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        "persisted_json.read_failed",
        expect.objectContaining({
          table: "sessions",
          column: "transcript_json",
          reason: "invalid_json",
        }),
      );

      const metricsText = await metrics.registry.getSingleMetricAsString(
        "persisted_json_read_failures_total",
      );
      expect(metricsText).toContain(
        'table="sessions",column="transcript_json",reason="invalid_json"',
      );
    } finally {
      await close();
    }
  });

  it("treats non-array transcript_json as empty instead of failing the whole query", async () => {
    const { db, close } = await openTestPostgresDb();
    try {
      const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
      const channelThreadDal = new ChannelThreadDal(db);
      const logger = { warn: vi.fn() };
      const metrics = new MetricsRegistry();
      const dal = new SessionDal(db, identityScopeDal, channelThreadDal, { logger, metrics });
      const s1 = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-1",
        containerKind: "group",
      });
      const s2 = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-2",
        containerKind: "group",
      });

      await db.run(
        "UPDATE sessions SET transcript_json = ? WHERE tenant_id = ? AND session_id = ?",
        ["{}", s1.tenant_id, s1.session_id],
      );

      const page = await dal.list({ connectorKey: "ui", limit: 10 });
      expect(page.sessions.map((s) => s.session_id).toSorted()).toEqual(
        [s1.session_key, s2.session_key].toSorted(),
      );

      const corrupted = page.sessions.find((s) => s.session_id === s1.session_key);
      expect(corrupted?.transcript_count).toBe(0);
      expect(corrupted?.last_text).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        "persisted_json.read_failed",
        expect.objectContaining({
          table: "sessions",
          column: "transcript_json",
          reason: "unexpected_shape",
        }),
      );

      const metricsText = await metrics.registry.getSingleMetricAsString(
        "persisted_json_read_failures_total",
      );
      expect(metricsText).toContain(
        'table="sessions",column="transcript_json",reason="unexpected_shape"',
      );
    } finally {
      await close();
    }
  });

  it("treats arrays with malformed turn items as empty and reports invalid_value", async () => {
    const { db, close } = await openTestPostgresDb();
    try {
      const identityScopeDal = new IdentityScopeDal(db, { cacheTtlMs: 60_000 });
      const channelThreadDal = new ChannelThreadDal(db);
      const logger = { warn: vi.fn() };
      const metrics = new MetricsRegistry();
      const dal = new SessionDal(db, identityScopeDal, channelThreadDal, { logger, metrics });
      const session = await dal.getOrCreate({
        connectorKey: "ui",
        providerThreadId: "thread-invalid-items",
        containerKind: "group",
      });

      await db.run(
        "UPDATE sessions SET transcript_json = ? WHERE tenant_id = ? AND session_id = ?",
        ['[{"role":"user"}]', session.tenant_id, session.session_id],
      );

      const page = await dal.list({ connectorKey: "ui", limit: 10 });
      const corrupted = page.sessions.find((s) => s.session_id === session.session_key);
      expect(corrupted?.transcript_count).toBe(0);
      expect(corrupted?.last_text).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        "persisted_json.read_failed",
        expect.objectContaining({
          table: "sessions",
          column: "transcript_json",
          reason: "invalid_value",
        }),
      );

      const metricsText = await metrics.registry.getSingleMetricAsString(
        "persisted_json_read_failures_total",
      );
      expect(metricsText).toContain(
        'table="sessions",column="transcript_json",reason="invalid_value"',
      );
    } finally {
      await close();
    }
  });
});
