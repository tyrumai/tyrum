/**
 * Retention data-access layer -- batch-delete operations for expired rows.
 */

import type { SqlDb } from "../../statestore/types.js";

const BATCH_LIMIT = 500;

/**
 * Delete rows older than cutoff date, limited to BATCH_LIMIT per call.
 * Returns number of rows deleted.
 */
export async function pruneByAge(
  db: SqlDb,
  table: string,
  timestampCol: string,
  cutoff: string,
): Promise<number> {
  const result = await db.run(
    `DELETE FROM "${table}" WHERE rowid IN (
       SELECT rowid FROM "${table}" WHERE "${timestampCol}" < ? LIMIT ${BATCH_LIMIT}
     )`,
    [cutoff],
  );
  return result.changes;
}

/**
 * Delete rows exceeding maxCount, keeping the most recent by orderCol.
 * Returns number of rows deleted.
 */
export async function pruneByCount(
  db: SqlDb,
  table: string,
  maxCount: number,
  orderCol: string,
): Promise<number> {
  const result = await db.run(
    `DELETE FROM "${table}" WHERE rowid IN (
       SELECT rowid FROM "${table}"
       ORDER BY "${orderCol}" ASC
       LIMIT MAX(0, (SELECT COUNT(*) FROM "${table}") - ${maxCount})
     )`,
    [],
  );
  return result.changes;
}
