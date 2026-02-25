import type { SqlDb } from "../statestore/types.js";

function quoteIdent(name: string): string {
  return `"${name.replaceAll(`"`, `""`)}"`;
}

export async function repairPostgresSequences(db: SqlDb, tables: string[]): Promise<void> {
  if (db.kind !== "postgres") return;

  for (const table of tables) {
    const serialCols = await db.all<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ?
         AND column_default LIKE 'nextval(%'`,
      [table],
    );
    for (const col of serialCols) {
      const colName = col.column_name;
      const maxRow = await db.get<{ max: number | null }>(
        `SELECT MAX(${quoteIdent(colName)}) as max FROM ${quoteIdent(table)}`,
      );
      const max = maxRow?.max;

      if (typeof max === "number" && Number.isFinite(max) && max >= 1) {
        await db.get(`SELECT setval(pg_get_serial_sequence(?, ?), ?, true)`, [table, colName, max]);
        continue;
      }

      // Empty table (MAX(...) is NULL) or invalid max values must not set sequences to 0
      // because Postgres sequences are 1-based by default and reject 0 when is_called=true.
      await db.get(`SELECT setval(pg_get_serial_sequence(?, ?), ?, false)`, [table, colName, 1]);
    }
  }
}
