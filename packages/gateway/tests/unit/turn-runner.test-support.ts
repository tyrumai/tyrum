import type { RunResult, SqlDb } from "../../src/statestore/types.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

async function wrapSingleTransaction<T>(
  base: SqliteDb,
  fn: (tx: SqlDb) => Promise<T>,
  overrideRun?: (tx: SqlDb, sql: string, params?: readonly unknown[]) => Promise<RunResult>,
): Promise<T> {
  return await base.transaction(
    async (tx) =>
      await fn({
        kind: tx.kind,
        get: async (sql, params) => await tx.get(sql, params),
        all: async (sql, params) => await tx.all(sql, params),
        run: async (sql, params) =>
          overrideRun ? await overrideRun(tx, sql, params) : await tx.run(sql, params),
        exec: async (sql) => await tx.exec(sql),
        transaction: async () => {
          throw new Error("nested transaction should not be opened");
        },
        close: async () => {},
      }),
  );
}

export function guardNestedTransactions(base: SqliteDb): SqlDb {
  return {
    kind: base.kind,
    get: async (sql, params) => await base.get(sql, params),
    all: async (sql, params) => await base.all(sql, params),
    run: async (sql, params) => await base.run(sql, params),
    exec: async (sql) => await base.exec(sql),
    transaction: async (fn) => await wrapSingleTransaction(base, fn),
    close: async () => await base.close(),
  };
}

export function interceptPauseUpdateResult(base: SqliteDb, changes: number): SqlDb {
  return {
    kind: base.kind,
    get: async (sql, params) => await base.get(sql, params),
    all: async (sql, params) => await base.all(sql, params),
    run: async (sql, params) => await base.run(sql, params),
    exec: async (sql) => await base.exec(sql),
    transaction: async (fn) =>
      await wrapSingleTransaction(base, fn, async (tx, sql, params) =>
        sql.includes("SET status = 'paused'") ? { changes } : await tx.run(sql, params),
      ),
    close: async () => await base.close(),
  };
}
