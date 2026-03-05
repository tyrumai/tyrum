import type { StateStoreKind } from "./types.js";

export type SqlBoolParam = boolean | 0 | 1;

export interface SqlClause {
  sql: string;
  params: readonly unknown[];
}

type DbKind = { kind: StateStoreKind };

export function sqlBoolParam(db: DbKind, value: boolean): SqlBoolParam {
  if (db.kind === "postgres") {
    return value;
  }
  return value ? 1 : 0;
}

export function sqlActiveWhereClause(db: DbKind): SqlClause {
  return { sql: "active = ?", params: [sqlBoolParam(db, true)] };
}
