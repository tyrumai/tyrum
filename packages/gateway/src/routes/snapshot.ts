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
} from "@tyrum/schemas";
import { Hono } from "hono";
import type { SqlDb } from "../statestore/types.js";
import { repairPostgresSequences } from "./snapshot-sequence-repair.js";

export interface SnapshotRouteDeps {
  db: SqlDb;
  version: string;
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
  "approvals",
  // Canvas
  "canvas_artifacts",
  // Execution engine
  "execution_jobs",
  "execution_runs",
  "execution_steps",
  "execution_attempts",
  "execution_artifacts",
  "idempotency_records",
  "resume_tokens",
  // Policy + pairing + channels
  "policy_snapshots",
  "policy_overrides",
  "routing_configs",
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
  "approvals",
  "canvas_artifacts",
  "policy_snapshots",
  "policy_overrides",
  "routing_configs",
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
  "execution_artifacts",
  "idempotency_records",
  "resume_tokens",
] as const;

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

function isSnapshotImportEnabled(): boolean {
  const raw = process.env["TYRUM_SNAPSHOT_IMPORT_ENABLED"]?.trim().toLowerCase();
  return Boolean(raw && !["0", "false", "off", "no"].includes(raw));
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
      .sort((a, b) => a.pk - b.pk)
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
    const values = cols.map((col) => {
      const v = row[col];
      return typeof v === "undefined" ? null : v;
    });
    const res = await db.run(sql, values);
    inserted += res.changes;
  }
  return inserted;
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

      const executionArtifactsColumns = tablesData["execution_artifacts"]?.columns ?? [];
      return SnapshotBundle.parse({
        format: "tyrum.snapshot.v2",
        exported_at: new Date().toISOString(),
        gateway_version: deps.version,
        db_kind: deps.db.kind,
        artifacts: {
          bytes: { included: false, included_sensitivity: [] },
          retention: {
            execution_artifacts: {
              included: Boolean(tablesData["execution_artifacts"]),
              has_retention_expires_at: executionArtifactsColumns.includes("retention_expires_at"),
              has_bytes_deleted_at: executionArtifactsColumns.includes("bytes_deleted_at"),
              has_bytes_deleted_reason: executionArtifactsColumns.includes("bytes_deleted_reason"),
            },
          },
        },
        tables: tablesData,
      });
    });

    return c.json(bundle, 200);
  });

  app.post("/snapshot/import", async (c) => {
    if (!isSnapshotImportEnabled()) {
      return c.json(
        {
          error: "disabled",
          message: "snapshot import is disabled (set TYRUM_SNAPSHOT_IMPORT_ENABLED=1)",
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
      for (const table of importTables) {
        insertedByTable[table] = await importTable(tx, table, bundle.tables[table]!);
      }

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
