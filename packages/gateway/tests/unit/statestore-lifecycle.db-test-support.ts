import type { SqlDb } from "../../src/statestore/types.js";

abstract class WrappedSqlDb implements SqlDb {
  readonly kind: SqlDb["kind"];

  constructor(protected readonly base: SqlDb) {
    this.kind = base.kind;
  }

  get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined> {
    return this.base.get(sql, params);
  }

  all<T>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    return this.base.all(sql, params);
  }

  exec(sql: string): Promise<void> {
    return this.base.exec(sql);
  }

  transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T> {
    return this.base.transaction(async (tx) => fn(this.wrap(tx)));
  }

  close(): Promise<void> {
    return this.base.close();
  }

  protected abstract wrap(tx: SqlDb): SqlDb;
  abstract run(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
}

class UnstableSessionTieBreakDb extends WrappedSqlDb {
  protected wrap(tx: SqlDb): SqlDb {
    return new UnstableSessionTieBreakDb(tx);
  }

  async run(sql: string, params?: readonly unknown[]): Promise<{ changes: number }> {
    const hasUnstableOrderBy =
      /ORDER BY updated_at ASC\s+LIMIT \?/i.test(sql) &&
      !/ORDER BY updated_at ASC,\s*conversation_id/i.test(sql);

    if (!hasUnstableOrderBy) {
      return await this.base.run(sql, params);
    }

    const injectTieBreak = (direction: "ASC" | "DESC"): string =>
      sql.replace(
        /ORDER BY updated_at ASC(\s+LIMIT \?)/i,
        `ORDER BY updated_at ASC, conversation_id ${direction}$1`,
      );

    // Simulate a database choosing different tie-breakers for separate DELETE statements
    // when ORDER BY does not fully order the result set.
    if (/DELETE FROM context_reports/i.test(sql)) {
      return await this.base.run(injectTieBreak("ASC"), params);
    }
    if (/DELETE FROM conversations/i.test(sql)) {
      return await this.base.run(injectTieBreak("DESC"), params);
    }

    return await this.base.run(sql, params);
  }
}

class RecordingDb extends WrappedSqlDb {
  constructor(
    base: SqlDb,
    private readonly runs: string[],
  ) {
    super(base);
  }

  protected wrap(tx: SqlDb): SqlDb {
    return new RecordingDb(tx, this.runs);
  }

  async run(sql: string, params?: readonly unknown[]): Promise<{ changes: number }> {
    this.runs.push(sql);
    return await this.base.run(sql, params);
  }
}

export function createUnstableSessionTieBreakDb(base: SqlDb): SqlDb {
  return new UnstableSessionTieBreakDb(base);
}

export function createRecordingDb(base: SqlDb, runs: string[]): SqlDb {
  return new RecordingDb(base, runs);
}
