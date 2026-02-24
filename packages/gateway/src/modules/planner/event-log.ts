import { computeEventHash } from "../audit/hash-chain.js";
import type { ChainableEvent } from "../audit/hash-chain.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import { isUniqueViolation } from "../../utils/sql-errors.js";

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
  created_at: string | Date;
  prev_hash: string | null;
  event_hash: string | null;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function rowToEvent(row: RawPlannerEventRow): PersistedPlannerEvent {
  return {
    id: row.id,
    replayId: row.replay_id,
    planId: row.plan_id,
    stepIndex: row.step_index,
    occurredAt: row.occurred_at,
    action: JSON.parse(row.action) as unknown,
    createdAt: normalizeTime(row.created_at),
  };
}

export class EventLog {
  constructor(
    private db: SqlDb,
    private readonly redactionEngine?: RedactionEngine,
    private readonly logger?: Logger,
  ) {}

  async append(event: NewPlannerEvent): Promise<AppendOutcome> {
    if (event.stepIndex < 0) {
      throw new Error(
        `step_index must be non-negative, got ${String(event.stepIndex)}`,
      );
    }

    const action = this.redactionEngine
      ? this.redactionEngine.redactUnknown(event.action).redacted
      : event.action;
    const actionJson = JSON.stringify(action);

    return await this.db.transaction(async (tx): Promise<AppendOutcome> => {
      const existing = await tx.get<{ id: number }>(
        "SELECT id FROM planner_events WHERE plan_id = ? AND step_index = ?",
        [event.planId, event.stepIndex],
      );
      if (existing) {
        this.logger?.debug("event.duplicate", {
          event_id: event.replayId,
          plan_id: event.planId,
          step_index: event.stepIndex,
        });
        return { kind: "duplicate" };
      }

      const lastRow = await tx.get<{ event_hash: string | null }>(
        "SELECT event_hash FROM planner_events WHERE plan_id = ? ORDER BY step_index DESC LIMIT 1",
        [event.planId],
      );
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

      try {
        const inserted = await tx.get<RawPlannerEventRow>(
          `INSERT INTO planner_events (replay_id, plan_id, step_index, occurred_at, action, prev_hash, event_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           RETURNING *`,
          [
            event.replayId,
            event.planId,
            event.stepIndex,
            event.occurredAt,
            actionJson,
            prevHash,
            eventHash,
          ],
        );

        if (!inserted) {
          throw new Error("planner_events insert returned no row");
        }

        const persisted = rowToEvent(inserted);
        this.logger?.debug("event.appended", {
          event_id: event.replayId,
          plan_id: event.planId,
          step_index: event.stepIndex,
          row_id: persisted.id,
        });
        return { kind: "inserted", event: persisted };
      } catch (err) {
        if (isUniqueViolation(err)) {
          this.logger?.debug("event.duplicate", {
            event_id: event.replayId,
            plan_id: event.planId,
            step_index: event.stepIndex,
          });
          return { kind: "duplicate" };
        }
        throw err;
      }
    });
  }

  /**
   * Append an event using the next available step_index for the given plan.
   *
   * Useful for audit streams that aren't naturally indexed by an existing
   * step counter (for example lifecycle event streams).
   */
  async appendNext(
    event: Omit<NewPlannerEvent, "stepIndex">,
    afterInsert?: (tx: SqlDb, persisted: PersistedPlannerEvent) => Promise<void>,
  ): Promise<PersistedPlannerEvent> {
    const action = this.redactionEngine
      ? this.redactionEngine.redactUnknown(event.action).redacted
      : event.action;
    const actionJson = JSON.stringify(action);

    const maxAttempts = 10;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.db.transaction(async (tx) => {
          const lastRow = await tx.get<{ step_index: number; event_hash: string | null }>(
            "SELECT step_index, event_hash FROM planner_events WHERE plan_id = ? ORDER BY step_index DESC LIMIT 1",
            [event.planId],
          );
          const prevHash = lastRow?.event_hash ?? null;
          const stepIndex = (lastRow?.step_index ?? -1) + 1;
          if (stepIndex < 0) {
            throw new Error("planner_events step_index overflow");
          }

          const eventHash = computeEventHash(
            {
              plan_id: event.planId,
              step_index: stepIndex,
              occurred_at: event.occurredAt,
              action: actionJson,
            },
            prevHash,
          );

          const inserted = await tx.get<RawPlannerEventRow>(
            `INSERT INTO planner_events (replay_id, plan_id, step_index, occurred_at, action, prev_hash, event_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             RETURNING *`,
            [
              event.replayId,
              event.planId,
              stepIndex,
              event.occurredAt,
              actionJson,
              prevHash,
              eventHash,
            ],
          );

          if (!inserted) {
            throw new Error("planner_events insert returned no row");
          }

          const persisted = rowToEvent(inserted);
          this.logger?.debug("event.appended", {
            event_id: event.replayId,
            plan_id: event.planId,
            step_index: stepIndex,
            row_id: persisted.id,
          });
          await afterInsert?.(tx, persisted);
          return persisted;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          continue;
        }
        throw err;
      }
    }

    throw new Error("failed to append planner event after retries");
  }

  async eventsForPlan(planId: string): Promise<PersistedPlannerEvent[]> {
    const rows = await this.db.all<RawPlannerEventRow>(
      "SELECT * FROM planner_events WHERE plan_id = ? ORDER BY step_index ASC",
      [planId],
    );
    return rows.map(rowToEvent);
  }

  /** Returns events with hash columns for chain verification. */
  async getEventsForVerification(planId: string): Promise<ChainableEvent[]> {
    const rows = await this.db.all<{
      id: number;
      plan_id: string;
      step_index: number;
      occurred_at: string;
      action: string;
      prev_hash: string | null;
      event_hash: string | null;
    }>(
      "SELECT id, plan_id, step_index, occurred_at, action, prev_hash, event_hash FROM planner_events WHERE plan_id = ? ORDER BY step_index ASC",
      [planId],
    );
    return rows;
  }
}
