import type { SqlDb, StateStoreKind } from "./types.js";

export type SqlBoolParam = boolean | 0 | 1;

export interface SqlClause {
  sql: string;
  params: readonly unknown[];
}

export function sqlBoolParam(db: Pick<SqlDb, "kind"> | { kind: StateStoreKind }, value: boolean) {
  if (db.kind === "postgres") {
    return value;
  }
  return value ? 1 : 0;
}

export function sqlActiveWhereClause(
  db: Pick<SqlDb, "kind"> | { kind: StateStoreKind },
): SqlClause {
  return { sql: "active = ?", params: [sqlBoolParam(db, true)] };
}
