/**
 * Retention policy configuration.
 */

export interface RetentionPolicy {
  table: string;
  /** Primary key column used for batched deletes across SQLite/Postgres. */
  idColumn: string;
  maxAgeDays?: number;
  maxCount?: number;
  timestampColumn: string;
}

export const DEFAULT_POLICIES: RetentionPolicy[] = [
  { table: "artifact_metadata", idColumn: "artifact_id", maxAgeDays: 90, timestampColumn: "created_at" },
  { table: "execution_runs", idColumn: "run_id", maxAgeDays: 90, timestampColumn: "finished_at" },
  { table: "outbox", idColumn: "id", maxAgeDays: 7, timestampColumn: "created_at" },
  { table: "planner_events", idColumn: "id", maxAgeDays: 30, timestampColumn: "created_at" },
  { table: "episodic_events", idColumn: "id", maxAgeDays: 30, timestampColumn: "created_at" },
];
