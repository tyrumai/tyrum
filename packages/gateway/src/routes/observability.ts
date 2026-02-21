/**
 * Read-only observability routes — /status, /usage, /context.
 */

import { Hono } from "hono";
import type { SqlDb } from "../statestore/types.js";
import type { MemoryDal } from "../modules/memory/dal.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import type { ContextReportDal } from "../modules/context/report-dal.js";

export interface ObservabilityDeps {
  db: SqlDb;
  memoryDal: MemoryDal;
  connectionManager?: ConnectionManager;
  contextReportDal?: ContextReportDal;
  version: string;
  startedAt: number;
  role: string;
}

export function createObservabilityRoutes(deps: ObservabilityDeps): Hono {
  const app = new Hono();

  app.get("/status", async (c) => {
    const uptime_ms = Date.now() - deps.startedAt;
    const connectionStats = deps.connectionManager?.getStats();

    return c.json({
      version: deps.version,
      uptime_ms,
      role: deps.role,
      db_type: deps.db.kind,
      connected_clients: connectionStats?.totalClients ?? 0,
      capability_counts: connectionStats?.capabilityCounts ?? {},
      feature_flags: getFeatureFlags(),
    });
  });

  app.get("/usage", async (c) => {
    const row = await deps.db.get<{
      total_runs: number;
      completed_runs: number;
      failed_runs: number;
      total_steps: number;
      total_attempts: number;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM execution_runs) AS total_runs,
        (SELECT COUNT(*) FROM execution_runs WHERE status = 'succeeded') AS completed_runs,
        (SELECT COUNT(*) FROM execution_runs WHERE status = 'failed') AS failed_runs,
        (SELECT COUNT(*) FROM execution_steps) AS total_steps,
        (SELECT COUNT(*) FROM execution_attempts) AS total_attempts`,
    );

    return c.json({
      runs: {
        total: row?.total_runs ?? 0,
        completed: row?.completed_runs ?? 0,
        failed: row?.failed_runs ?? 0,
      },
      steps: { total: row?.total_steps ?? 0 },
      attempts: { total: row?.total_attempts ?? 0 },
    });
  });

  app.get("/context", async (c) => {
    const factCount = await deps.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM facts",
    );
    const eventCount = await deps.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM episodic_events",
    );
    const capabilityCount = await deps.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM capability_memories",
    );
    const sessionCount = await deps.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sessions",
    );

    return c.json({
      memory: {
        facts: factCount?.n ?? 0,
        episodic_events: eventCount?.n ?? 0,
        capability_memories: capabilityCount?.n ?? 0,
      },
      sessions: {
        total: sessionCount?.n ?? 0,
      },
    });
  });

  app.get("/context/list", async (c) => {
    if (!deps.contextReportDal) {
      return c.json({ reports: [] });
    }
    const limit = Math.min(Number(c.req.query("limit") || 50), 200);
    const offset = Math.max(Number(c.req.query("offset") || 0), 0);
    const rows = await deps.contextReportDal.list(limit, offset);
    return c.json({
      reports: rows.map((r) => ({
        report_id: r.report_id,
        run_id: r.run_id,
        created_at: r.created_at,
      })),
    });
  });

  app.get("/context/detail/:run_id", async (c) => {
    if (!deps.contextReportDal) {
      return c.json({ error: "context reports not enabled" }, 501);
    }
    const runId = c.req.param("run_id");
    const row = await deps.contextReportDal.getByRunId(runId);
    if (!row) {
      return c.json({ error: "no context report for this run" }, 404);
    }
    return c.json({
      report_id: row.report_id,
      run_id: row.run_id,
      created_at: row.created_at,
      report: JSON.parse(row.report_json),
    });
  });

  return app;
}

function getFeatureFlags(): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("TYRUM_") && value !== undefined) {
      const trimmed = value.trim().toLowerCase();
      if (["0", "false", "off", "no"].includes(trimmed)) {
        flags[key] = false;
      } else if (["1", "true", "on", "yes", ""].includes(trimmed) || trimmed.length > 0) {
        flags[key] = true;
      }
    }
  }
  return flags;
}
