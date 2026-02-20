import type Database from "better-sqlite3";
import { computeEventHash } from "../audit/hash-chain.js";
import type { ChainableEvent } from "../audit/hash-chain.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { Logger } from "../observability/logger.js";

export interface NewPlannerEvent {
  replayId: string;
  planId: string;
  stepIndex: number;
  occurredAt: string;
  action: unknown;
}

export interface PersistedPlannerEvent extends NewPlannerEvent {
  id: number;
  createdAt: string;
}

export type AppendOutcome =
  | { kind: "inserted"; event: PersistedPlannerEvent }
  | { kind: "duplicate" };

interface RawPlannerEventRow {
  id: number;
  replay_id: string;
  plan_id: string;
  step_index: number;
  occurred_at: string;
  action: string;
  created_at: string;
  prev_hash: string | null;
  event_hash: string | null;
}

function rowToEvent(row: RawPlannerEventRow): PersistedPlannerEvent {
  return {
    id: row.id,
    replayId: row.replay_id,
    planId: row.plan_id,
    stepIndex: row.step_index,
    occurredAt: row.occurred_at,
    action: JSON.parse(row.action) as unknown,
    createdAt: row.created_at,
  };
}

export class EventLog {
  constructor(
    private db: Database.Database,
    private readonly redactionEngine?: RedactionEngine,
    private readonly logger?: Logger,
  ) {}

  append(event: NewPlannerEvent): AppendOutcome {
    if (event.stepIndex < 0) {
      throw new Error(
        `step_index must be non-negative, got ${String(event.stepIndex)}`,
      );
    }

    const action = this.redactionEngine
      ? this.redactionEngine.redactUnknown(event.action).redacted
      : event.action;
    const actionJson = JSON.stringify(action);

    // SQLite does not support RETURNING with ON CONFLICT DO NOTHING,
    // so we use a transaction: attempt insert, detect UNIQUE violation.
    const doAppend = this.db.transaction((): AppendOutcome => {
      // Check for existing row with this (plan_id, step_index) combination
      const existing = this.db
        .prepare(
          "SELECT id FROM planner_events WHERE plan_id = ? AND step_index = ?",
        )
        .get(event.planId, event.stepIndex) as
        | { id: number }
        | undefined;

      if (existing) {
        this.logger?.debug("event.duplicate", {
          event_id: event.replayId,
          plan_id: event.planId,
          step_index: event.stepIndex,
        });
        return { kind: "duplicate" };
      }

      // Fetch the last event's hash for this plan to chain
      const lastRow = this.db
        .prepare(
          "SELECT event_hash FROM planner_events WHERE plan_id = ? ORDER BY step_index DESC LIMIT 1",
        )
        .get(event.planId) as { event_hash: string | null } | undefined;

      const prevHash = lastRow?.event_hash ?? null;

      const eventHash = computeEventHash(
        {
          plan_id: event.planId,
          step_index: event.stepIndex,
          occurred_at: event.occurredAt,
          action: actionJson,
        },
        prevHash,
      );

      const result = this.db
        .prepare(
          `INSERT INTO planner_events (replay_id, plan_id, step_index, occurred_at, action, prev_hash, event_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.replayId,
          event.planId,
          event.stepIndex,
          event.occurredAt,
          actionJson,
          prevHash,
          eventHash,
        );

      const inserted = this.db
        .prepare("SELECT * FROM planner_events WHERE id = ?")
        .get(Number(result.lastInsertRowid)) as RawPlannerEventRow;

      const persisted = rowToEvent(inserted);
      this.logger?.debug("event.appended", {
        event_id: event.replayId,
        plan_id: event.planId,
        step_index: event.stepIndex,
        row_id: persisted.id,
      });
      return { kind: "inserted", event: persisted };
    });

    return doAppend();
  }

  eventsForPlan(planId: string): PersistedPlannerEvent[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM planner_events WHERE plan_id = ? ORDER BY step_index ASC",
      )
      .all(planId) as RawPlannerEventRow[];
    return rows.map(rowToEvent);
  }

  /** Returns events with hash columns for chain verification. */
  getEventsForVerification(planId: string): ChainableEvent[] {
    const rows = this.db
      .prepare(
        "SELECT id, plan_id, step_index, occurred_at, action, prev_hash, event_hash FROM planner_events WHERE plan_id = ? ORDER BY step_index ASC",
      )
      .all(planId) as Array<{
      id: number;
      plan_id: string;
      step_index: number;
      occurred_at: string;
      action: string;
      prev_hash: string | null;
      event_hash: string | null;
    }>;
    return rows;
  }
}
