/**
 * Snapshot import — restore durable tables from a previously exported bundle.
 *
 * Clears all durable tables (in reverse dependency order) then inserts rows
 * from the bundle (in forward dependency order) within a single transaction.
 */

import type { SqlDb } from "../../statestore/types.js";
import { getExportedTableNames, type SnapshotBundle } from "./export.js";

export interface ImportResult {
  tables_imported: number;
  rows_imported: number;
}

export async function importSnapshot(
  db: SqlDb,
  bundle: SnapshotBundle,
): Promise<ImportResult> {
  if (bundle.version !== 1) {
    throw new Error(`Unsupported snapshot version: ${bundle.version}`);
  }

  const allowedTables = new Set(getExportedTableNames());
  for (const name of Object.keys(bundle.tables)) {
    if (!allowedTables.has(name)) {
      throw new Error(`Unknown table in snapshot bundle: ${name}`);
    }
  }

  return await db.transaction(async (tx) => {
    // Delete in reverse dependency order to respect FK constraints
    const durableTables = getExportedTableNames();
    const reversed = [...durableTables].reverse();
    for (const table of reversed) {
      await tx.run(`DELETE FROM ${table}`, []);
    }

    let tablesImported = 0;
    let rowsImported = 0;

    // Insert in forward dependency order
    for (const table of durableTables) {
      const rows = bundle.tables[table];
      if (!rows || rows.length === 0) continue;

      tablesImported++;
      for (const raw of rows) {
        const row = raw as Record<string, unknown>;
        const cols = Object.keys(row);
        if (cols.length === 0) continue;

        const placeholders = cols.map(() => "?").join(", ");
        const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`;
        await tx.run(sql, cols.map((c) => row[c]));
        rowsImported++;
      }
    }

    return { tables_imported: tablesImported, rows_imported: rowsImported };
  });
}
