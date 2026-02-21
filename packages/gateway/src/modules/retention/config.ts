/**
 * Retention policy configuration.
 */

export interface RetentionPolicy {
  table: string;
  maxAgeDays?: number;
  maxCount?: number;
  timestampColumn: string;
}

export const DEFAULT_POLICIES: RetentionPolicy[] = [
  { table: "artifact_metadata", maxAgeDays: 90, timestampColumn: "created_at" },
  { table: "execution_runs", maxAgeDays: 90, timestampColumn: "finished_at" },
  { table: "outbox", maxAgeDays: 7, timestampColumn: "created_at" },
  { table: "planner_events", maxAgeDays: 30, timestampColumn: "created_at" },
  { table: "episodic_events", maxAgeDays: 30, timestampColumn: "created_at" },
];
