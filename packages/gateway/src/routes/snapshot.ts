/**
 * Snapshot export/import routes — durable StateStore backups.
 *
 * These routes provide a minimal, versioned JSON snapshot bundle for the
 * tables required to reconstruct sessions, approvals, execution, and policy.
 *
 * - Export is transactionally consistent.
 * - Import is gated and defaults to "empty DB only".
 */

import {
  SnapshotBundle,
  SnapshotImportRequest,
  type SnapshotTable as SnapshotTableT,
} from "@tyrum/contracts";
import { Hono } from "hono";
import { parseScheduleConfig } from "../app/modules/automation/schedule-service.js";
import type { SqlDb } from "../statestore/types.js";
import { repairPostgresSequences } from "./snapshot-sequence-repair.js";

export interface SnapshotRouteDeps {
  db: SqlDb;
  version: string;
  importEnabled: boolean;
}

const DEFAULT_TABLES = [
  // Channels + audit + sessions
  "channel_accounts",
  "channel_threads",
  "sessions",
  "plans",
  "planner_events",
  "context_reports",
  // Memory (v1 canonical)
  "memory_items",
  "memory_item_provenance",
  "memory_item_tags",
  "memory_tombstones",
  "memory_item_embeddings",
  "vector_metadata",
  // Automation + approvals
  "watchers",
  "watcher_firings",
  "review_entries",
  "approvals",
  // Canvas
  "canvas_artifacts",
  // Execution engine
  "execution_jobs",
  "execution_runs",
  "execution_steps",
  "execution_attempts",
  "artifacts",
  "artifact_access",
  "artifact_links",
  "idempotency_records",
  "resume_tokens",
  // Policy + pairing + channels
  "policy_snapshots",
  "policy_overrides",
  "routing_configs",
  "channel_configs",
  "extension_defaults",
  // Models/auth profiles
  "auth_profiles",
  "session_provider_pins",
  "secret_resolutions",
  "node_pairings",
  "channel_inbox",
  "channel_outbox",
] as const;

const IMPORT_ORDER = [
  "channel_accounts",
  "channel_threads",
  "sessions",
  "plans",
  "planner_events",
  "context_reports",
  "memory_items",
  "memory_item_provenance",
  "memory_item_tags",
  "memory_tombstones",
  "memory_item_embeddings",
  "vector_metadata",
  "watchers",
  "watcher_firings",
  "review_entries",
  "approvals",
  "canvas_artifacts",
  "policy_snapshots",
  "policy_overrides",
  "routing_configs",
  "channel_configs",
  "extension_defaults",
  "auth_profiles",
  "session_provider_pins",
  "secret_resolutions",
  "node_pairings",
  "channel_inbox",
  "channel_outbox",
  "execution_jobs",
  "execution_runs",
  "execution_steps",
  "execution_attempts",
  "artifacts",
  "artifact_access",
  "artifact_links",
  "idempotency_records",
  "resume_tokens",
] as const;

const DEFERRED_APPROVAL_EXECUTION_REF_COLUMNS = ["run_id", "step_id", "attempt_id"] as const;

interface DeferredApprovalExecutionRefPatch {
  tenantId: unknown;
  approvalId: unknown;
  runId: unknown;
  stepId: unknown;
  attemptId: unknown;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll(`"`, `""`)}"`;
}

function parseTablesParam(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function rowValue(row: Record<string, unknown>, column: string): unknown {
  const value = row[column];
  return typeof value === "undefined" ? null : value;
}

async function tableExists(db: SqlDb, table: string): Promise<boolean> {
  if (db.kind === "sqlite") {
    const row = await db.get<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
      [table],
    );
    return Boolean(row?.name);
  }
  const row = await db.get<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ?`,
    [table],
  );
  return Boolean(row?.table_name);
}

async function listColumns(db: SqlDb, table: string): Promise<string[]> {
  if (db.kind === "sqlite") {
    const rows = await db.all<{ name: string }>(`PRAGMA table_info(${quoteIdent(table)})`);
    return rows.map((r) => r.name).filter((n) => typeof n === "string" && n.length > 0);
  }
  const rows = await db.all<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ?
     ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name).filter((n) => typeof n === "string" && n.length > 0);
}

async function listPrimaryKeyColumns(db: SqlDb, table: string): Promise<string[]> {
  if (db.kind === "sqlite") {
    const rows = await db.all<{ name: string; pk: number }>(
      `PRAGMA table_info(${quoteIdent(table)})`,
    );
    return rows
      .filter((r) => typeof r.pk === "number" && r.pk > 0)
      .toSorted((a, b) => a.pk - b.pk)
      .map((r) => r.name);
  }

  const rows = await db.all<{ column_name: string }>(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema = 'public'
       AND tc.table_name = ?
     ORDER BY kcu.ordinal_position`,
    [table],
  );
  return rows.map((r) => r.column_name);
}

async function exportTable(db: SqlDb, table: string): Promise<SnapshotTableT> {
  const columns = await listColumns(db, table);
  if (columns.length === 0) {
    throw new Error(`snapshot export: no columns found for table '${table}'`);
  }
  const pk = await listPrimaryKeyColumns(db, table);
  const orderBy = pk.length > 0 ? pk : [columns[0]!];

  const sql =
    `SELECT ${columns.map(quoteIdent).join(", ")} FROM ${quoteIdent(table)}` +
    ` ORDER BY ${orderBy.map(quoteIdent).join(", ")}`;
  const rows = await db.all<Record<string, unknown>>(sql);
  return { columns, rows };
}

async function rowCount(db: SqlDb, table: string): Promise<number> {
  const row = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM ${quoteIdent(table)}`);
  const raw = row?.c;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

async function pruneSeededDefaultHeartbeatSchedules(db: SqlDb): Promise<void> {
  if (!(await tableExists(db, "watchers"))) {
    return;
  }

  const rows = await db.all<{ watcher_id: string; trigger_config_json: string }>(
    `SELECT watcher_id, trigger_config_json
     FROM watchers`,
  );
  const watcherIds = rows
    .filter((row: { watcher_id: string; trigger_config_json: string }) => {
      const config = parseScheduleConfig(row.trigger_config_json);
      return config?.schedule_kind === "heartbeat" && config.seeded_default === true;
    })
    .map((row: { watcher_id: string; trigger_config_json: string }) => row.watcher_id);
  if (watcherIds.length === 0) {
    return;
  }

  const placeholders = watcherIds.map(() => "?").join(", ");
  if (await tableExists(db, "watcher_firings")) {
    await db.run(
      `DELETE FROM watcher_firings
       WHERE watcher_id IN (${placeholders})`,
      watcherIds,
    );
  }
  await db.run(
    `DELETE FROM watchers
     WHERE watcher_id IN (${placeholders})`,
    watcherIds,
  );
}

async function importTable(db: SqlDb, table: string, data: SnapshotTableT): Promise<number> {
  const existingColumns = new Set(await listColumns(db, table));
  for (const col of data.columns) {
    if (!existingColumns.has(col)) {
      throw new Error(`snapshot import: column '${col}' missing in target table '${table}'`);
    }
  }

  const cols = data.columns;
  const placeholders = cols.map(() => "?").join(", ");
  const sql =
    `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(", ")})` +
    ` VALUES (${placeholders})`;

  let inserted = 0;
  for (const row of data.rows) {
    const values = cols.map((col: string) => rowValue(row, col));
    const res = await db.run(sql, values);
    inserted += res.changes;
  }
  return inserted;
}

function prepareApprovalImportWithDeferredExecutionRefs(data: SnapshotTableT): {
  data: SnapshotTableT;
  deferredPatches: DeferredApprovalExecutionRefPatch[];
} {
  const deferredColumns = DEFERRED_APPROVAL_EXECUTION_REF_COLUMNS.filter((column) =>
    data.columns.includes(column),
  );
  if (deferredColumns.length === 0) {
    return { data, deferredPatches: [] };
  }

  if (!data.columns.includes("tenant_id") || !data.columns.includes("approval_id")) {
    throw new Error("snapshot import: approvals rows require tenant_id and approval_id");
  }

  return {
    data: {
      columns: data.columns,
      rows: data.rows.map((row: Record<string, unknown>) => {
        const sanitizedRow: Record<string, unknown> = { ...row };
        for (const column of deferredColumns) {
          sanitizedRow[column] = null;
        }
        return sanitizedRow;
      }),
    },
    deferredPatches: data.rows.flatMap((row: Record<string, unknown>) => {
      const patch = {
        tenantId: rowValue(row, "tenant_id"),
        approvalId: rowValue(row, "approval_id"),
        runId: rowValue(row, "run_id"),
        stepId: rowValue(row, "step_id"),
        attemptId: rowValue(row, "attempt_id"),
      };
      return patch.runId === null && patch.stepId === null && patch.attemptId === null
        ? []
        : [patch];
    }),
  };
}

async function applyDeferredApprovalExecutionRefPatches(
  db: SqlDb,
  patches: DeferredApprovalExecutionRefPatch[],
): Promise<void> {
  // approvals.step_id and execution_steps.approval_id form a cycle, so restore
  // the approvals-side execution refs only after both tables are populated.
  for (const patch of patches) {
    const res = await db.run(
      `UPDATE approvals
       SET run_id = ?, step_id = ?, attempt_id = ?
       WHERE tenant_id = ? AND approval_id = ?`,
      [patch.runId, patch.stepId, patch.attemptId, patch.tenantId, patch.approvalId],
    );
    if (res.changes !== 1) {
      throw new Error(
        `snapshot import: failed to restore approvals execution refs for approval '${String(patch.approvalId)}'`,
      );
    }
  }
}

async function repairSqliteAutoincrement(db: SqlDb, tables: string[]): Promise<void> {
  if (db.kind !== "sqlite") return;
  // Best-effort: ensure sqlite_sequence stays >= max(pk) for AUTOINCREMENT tables.
  for (const table of tables) {
    const cols = await listPrimaryKeyColumns(db, table);
    if (cols.length !== 1) continue;
    const pk = cols[0]!;
    try {
      await db.exec(
        `UPDATE sqlite_sequence
         SET seq = (SELECT COALESCE(MAX(${quoteIdent(pk)}), 0) FROM ${quoteIdent(table)})
         WHERE name = '${table.replaceAll("'", "''")}'`,
      );
    } catch (err) {
      void err;
      // ignore: sqlite_sequence may not exist for non-AUTOINCREMENT tables
    }
  }
}

export function createSnapshotRoutes(deps: SnapshotRouteDeps): Hono {
  const app = new Hono();

  app.get("/snapshot/export", async (c) => {
    const requested = parseTablesParam(c.req.query("tables"));
    const tables = requested ?? [...DEFAULT_TABLES];

    for (const t of tables) {
      if (!DEFAULT_TABLES.includes(t as (typeof DEFAULT_TABLES)[number])) {
        return c.json({ error: "invalid_request", message: `unknown table '${t}'` }, 400);
      }
    }

    const bundle = await deps.db.transaction(async (tx) => {
      if (tx.kind === "postgres") {
        // Ensure all SELECTs in this transaction see the same snapshot.
        await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      }

      const tablesData: Record<string, SnapshotTableT> = {};
      for (const table of tables) {
        if (!(await tableExists(tx, table))) {
          throw new Error(`snapshot export: table '${table}' does not exist`);
        }
        tablesData[table] = await exportTable(tx, table);
      }

      const artifactColumns = tablesData["artifacts"]?.columns ?? [];
      return SnapshotBundle.parse({
        format: "tyrum.snapshot.v2",
        exported_at: new Date().toISOString(),
        gateway_version: deps.version,
        db_kind: deps.db.kind,
        artifacts: {
          bytes: { included: false, included_sensitivity: [] },
          retention: {
            artifacts: {
              included: Boolean(tablesData["artifacts"]),
              has_retention_expires_at: artifactColumns.includes("retention_expires_at"),
              has_bytes_deleted_at: artifactColumns.includes("bytes_deleted_at"),
              has_bytes_deleted_reason: artifactColumns.includes("bytes_deleted_reason"),
            },
          },
        },
        tables: tablesData,
      });
    });

    return c.json(bundle, 200);
  });

  app.post("/snapshot/import", async (c) => {
    if (!deps.importEnabled) {
      return c.json(
        {
          error: "disabled",
          message: "snapshot import is disabled",
        },
        403,
      );
    }

    const raw = (await c.req.json()) as unknown;
    const parsed = SnapshotImportRequest.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_request", message: parsed.error.message }, 400);
    }

    const bundle = parsed.data.bundle;
    const tables = Object.keys(bundle.tables);
    for (const t of tables) {
      if (!DEFAULT_TABLES.includes(t as (typeof DEFAULT_TABLES)[number])) {
        return c.json({ error: "invalid_request", message: `unknown table '${t}'` }, 400);
      }
    }

    const importTables = [
      ...IMPORT_ORDER.filter((t) => tables.includes(t)),
      ...tables.filter((t) => !IMPORT_ORDER.includes(t as (typeof IMPORT_ORDER)[number])),
    ];

    const outcome = await deps.db.transaction(async (tx) => {
      if (importTables.includes("watchers")) {
        await pruneSeededDefaultHeartbeatSchedules(tx);
      }

      const counts: Record<string, number> = {};
      for (const table of importTables) {
        if (!(await tableExists(tx, table))) {
          throw new Error(`snapshot import: table '${table}' does not exist`);
        }
        const count = await rowCount(tx, table);
        counts[table] = count;
        if (count > 0) {
          throw new Error(
            `snapshot import refused: table '${table}' is not empty (rows=${String(count)})`,
          );
        }
      }

      const insertedByTable: Record<string, number> = {};
      const deferredApprovalExecutionRefPatches: DeferredApprovalExecutionRefPatch[] = [];
      for (const table of importTables) {
        let tableData = bundle.tables[table]!;
        if (table === "approvals") {
          const prepared = prepareApprovalImportWithDeferredExecutionRefs(tableData);
          tableData = prepared.data;
          deferredApprovalExecutionRefPatches.push(...prepared.deferredPatches);
        }
        insertedByTable[table] = await importTable(tx, table, tableData);
      }
      await applyDeferredApprovalExecutionRefPatches(tx, deferredApprovalExecutionRefPatches);

      await repairPostgresSequences(tx, importTables);
      await repairSqliteAutoincrement(tx, importTables);

      const total = Object.values(insertedByTable).reduce((acc, v) => acc + v, 0);
      return { insertedByTable, total };
    });

    return c.json(
      {
        status: "ok",
        imported_at: new Date().toISOString(),
        format: bundle.format,
        tables: importTables,
        inserted_total: outcome.total,
        inserted_by_table: outcome.insertedByTable,
      },
      200,
    );
  });

  return app;
}
