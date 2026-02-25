export type StateStoreKind = "sqlite" | "postgres";

export interface RunResult {
  changes: number;
}

export interface SqlDb {
  readonly kind: StateStoreKind;
  get<T>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  run(sql: string, params?: readonly unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
