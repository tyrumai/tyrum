import type Database from "better-sqlite3";

export function getSqliteColumns(db: Database.Database, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export async function getPostgresColumns(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  table: string,
): Promise<string[]> {
  const res = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return (res.rows as Array<{ column_name: string }>).map((r) => r.column_name);
}
