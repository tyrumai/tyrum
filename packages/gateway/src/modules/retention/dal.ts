/**
 * Retention data-access layer -- batch-delete operations for expired rows.
 */

import type { SqlDb } from "../../statestore/types.js";

const BATCH_LIMIT = 500;

function safeIdentifier(value: string): string {
  // Identifiers are not parameterizable; enforce a strict allowlist to avoid SQL injection.
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`invalid identifier: '${value}'`);
  }
  return value;
}

/**
 * Delete rows older than cutoff date, limited to BATCH_LIMIT per call.
 * Returns number of rows deleted.
 */
export async function pruneByAge(
  db: SqlDb,
  table: string,
  idColumn: string,
  timestampCol: string,
  cutoff: string,
): Promise<number> {
  const safeTable = safeIdentifier(table);
  const safeId = safeIdentifier(idColumn);
  const safeTs = safeIdentifier(timestampCol);

  const candidates = await db.all<{ id: unknown }>(
    `SELECT "${safeId}" AS id FROM "${safeTable}"
     WHERE "${safeTs}" < ?
     ORDER BY "${safeTs}" ASC
     LIMIT ${BATCH_LIMIT}`,
    [cutoff],
  );

  const ids = candidates.map((r) => r.id);
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.run(
    `DELETE FROM "${safeTable}"
     WHERE "${safeId}" IN (${placeholders})
       AND "${safeTs}" < ?`,
    [...ids, cutoff],
  );
  return result.changes;
}

/**
 * Delete rows exceeding maxCount, keeping the most recent by orderCol.
 * Deletes up to BATCH_LIMIT rows per call.
 * Returns number of rows deleted.
 */
export async function pruneByCount(
  db: SqlDb,
  table: string,
  idColumn: string,
  maxCount: number,
  orderCol: string,
): Promise<number> {
  const safeTable = safeIdentifier(table);
  const safeId = safeIdentifier(idColumn);
  const safeOrder = safeIdentifier(orderCol);

  const row = await db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM "${safeTable}"`);
  const currentCount = row?.count ?? 0;
  const deleteCount = Math.max(0, currentCount - Math.max(0, Math.floor(maxCount)));
  if (deleteCount === 0) return 0;

  const bounded = Math.min(deleteCount, BATCH_LIMIT);
  const candidates = await db.all<{ id: unknown }>(
    `SELECT "${safeId}" AS id FROM "${safeTable}"
     ORDER BY "${safeOrder}" ASC
     LIMIT ${bounded}`,
  );

  const ids = candidates.map((r) => r.id);
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.run(
    `DELETE FROM "${safeTable}" WHERE "${safeId}" IN (${placeholders})`,
    ids,
  );
  return result.changes;
}
