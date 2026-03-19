import { computeEventHash } from "../audit/hash-chain.js";
import type { ChainableEvent } from "../audit/hash-chain.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { Logger } from "../observability/logger.js";
import type { SqlDb } from "../../statestore/types.js";
import type { AuditPlanSummary } from "@tyrum/contracts";
import { isUniqueViolation } from "../../utils/sql-errors.js";
import { insertPlannerEventNext, retryOnUniqueViolation } from "./planner-events.js";
import { PlanDal } from "./plan-dal.js";
import { DEFAULT_AGENT_ID, DEFAULT_WORKSPACE_ID } from "../identity/scope.js";

export interface NewPlannerEvent {
  tenantId: string;
  replayId: string;
  planKey: string;
  stepIndex: number;
  occurredAt: string;
  action: unknown;
}

export interface PersistedPlannerEvent extends NewPlannerEvent {
  /** Compatibility identifier (equal to stepIndex). */
  id: number;
  planId: string;
  createdAt: string;
}

export type AppendOutcome =
  | { kind: "inserted"; event: PersistedPlannerEvent }
  | { kind: "duplicate" };

interface RawPlannerEventRow {
  tenant_id: string;
  replay_id: string;
  plan_id: string;
  step_index: number;
  occurred_at: string;
  action_json: string;
  created_at: string | Date;
  prev_hash: string | null;
  event_hash: string | null;
}

interface RawAuditPlanSummaryRow {
  plan_key: string;
  plan_id: string;
  kind: string;
  status: string;
  event_count: number | string;
  last_event_at: string;
}

function asFiniteNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeTime(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function rowToEvent(row: RawPlannerEventRow, planKey: string): PersistedPlannerEvent {
  return {
    tenantId: row.tenant_id,
    replayId: row.replay_id,
    planId: row.plan_id,
    planKey,
    stepIndex: row.step_index,
    id: row.step_index,
    occurredAt: row.occurred_at,
    action: JSON.parse(row.action_json) as unknown,
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
      throw new Error(`step_index must be non-negative, got ${String(event.stepIndex)}`);
    }
    if (!event.tenantId.trim()) {
      throw new Error("tenantId is required");
    }
    if (!event.planKey.trim()) {
      throw new Error("planKey is required");
    }

    const action = this.redactionEngine
      ? this.redactionEngine.redactUnknown(event.action).redacted
      : event.action;
    const actionJson = JSON.stringify(action);

    return await this.db.transaction(async (tx): Promise<AppendOutcome> => {
      const planId = await new PlanDal(tx).ensurePlanId({
        tenantId: event.tenantId,
        planKey: event.planKey,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        kind: "audit",
        status: "active",
      });

      const existing = await tx.get<{ n: number }>(
        `SELECT 1 AS n
         FROM planner_events
         WHERE tenant_id = ? AND plan_id = ? AND step_index = ?
         LIMIT 1`,
        [event.tenantId, planId, event.stepIndex],
      );
      if (existing) {
        this.logger?.debug("event.duplicate", {
          event_id: event.replayId,
          plan_id: planId,
          step_index: event.stepIndex,
        });
        return { kind: "duplicate" };
      }

      const lastRow = await tx.get<{ event_hash: string | null }>(
        `SELECT event_hash
         FROM planner_events
         WHERE tenant_id = ? AND plan_id = ?
         ORDER BY step_index DESC
         LIMIT 1`,
        [event.tenantId, planId],
      );
      const prevHash = lastRow?.event_hash ?? null;

      const eventHash = computeEventHash(
        {
          plan_id: planId,
          step_index: event.stepIndex,
          occurred_at: event.occurredAt,
          action: actionJson,
        },
        prevHash,
      );

      try {
        const inserted = await tx.get<RawPlannerEventRow>(
          `INSERT INTO planner_events (
             tenant_id,
             plan_id,
             step_index,
             replay_id,
             occurred_at,
             action_json,
             prev_hash,
             event_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING *`,
          [
            event.tenantId,
            planId,
            event.stepIndex,
            event.replayId,
            event.occurredAt,
            actionJson,
            prevHash,
            eventHash,
          ],
        );

        if (!inserted) {
          throw new Error("planner_events insert returned no row");
        }

        const persisted = rowToEvent(inserted, event.planKey);
        this.logger?.debug("event.appended", {
          event_id: event.replayId,
          plan_id: planId,
          step_index: event.stepIndex,
        });
        return { kind: "inserted", event: persisted };
      } catch (err) {
        if (isUniqueViolation(err)) {
          this.logger?.debug("event.duplicate", {
            event_id: event.replayId,
            plan_id: planId,
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
    if (!event.tenantId.trim()) {
      throw new Error("tenantId is required");
    }
    if (!event.planKey.trim()) {
      throw new Error("planKey is required");
    }
    const action = this.redactionEngine
      ? this.redactionEngine.redactUnknown(event.action).redacted
      : event.action;
    const actionJson = JSON.stringify(action);

    return await retryOnUniqueViolation(
      async () =>
        await this.db.transaction(async (tx) => {
          const planId = await new PlanDal(tx).ensurePlanId({
            tenantId: event.tenantId,
            planKey: event.planKey,
            agentId: DEFAULT_AGENT_ID,
            workspaceId: DEFAULT_WORKSPACE_ID,
            kind: "audit",
            status: "active",
          });
          const { inserted } = await insertPlannerEventNext<RawPlannerEventRow>(tx, {
            tenantId: event.tenantId,
            replayId: event.replayId,
            planId,
            occurredAt: event.occurredAt,
            actionJson,
            returning: "*",
          });

          const persisted = rowToEvent(inserted, event.planKey);
          this.logger?.debug("event.appended", {
            event_id: event.replayId,
            plan_id: planId,
            step_index: persisted.stepIndex,
          });
          await afterInsert?.(tx, persisted);
          return persisted;
        }),
      { failureMessage: "failed to append planner event after retries" },
    );
  }

  async eventsForPlan(input: {
    tenantId: string;
    planKey: string;
  }): Promise<PersistedPlannerEvent[]> {
    const plan = await new PlanDal(this.db).getByKey({
      tenantId: input.tenantId,
      planKey: input.planKey,
    });
    if (!plan) return [];

    const rows = await this.db.all<RawPlannerEventRow>(
      `SELECT *
       FROM planner_events
       WHERE tenant_id = ? AND plan_id = ?
       ORDER BY step_index ASC`,
      [input.tenantId, plan.plan_id],
    );
    return rows.map((row) => rowToEvent(row, input.planKey));
  }

  /** Returns events with hash columns for chain verification. */
  async getEventsForVerification(input: {
    tenantId: string;
    planKey: string;
  }): Promise<ChainableEvent[]> {
    const plan = await new PlanDal(this.db).getByKey({
      tenantId: input.tenantId,
      planKey: input.planKey,
    });
    if (!plan) return [];

    const rows = await this.db.all<ChainableEvent>(
      `SELECT
         step_index AS id,
         plan_id,
         step_index,
         occurred_at,
         action_json AS action,
         prev_hash,
         event_hash
       FROM planner_events
       WHERE tenant_id = ? AND plan_id = ?
       ORDER BY step_index ASC`,
      [input.tenantId, plan.plan_id],
    );
    return rows;
  }

  async listRecentPlans(input: { tenantId: string; limit?: number }): Promise<AuditPlanSummary[]> {
    const requestedLimit = input.limit ?? 100;
    const limit = Math.max(1, Math.min(100, Math.trunc(requestedLimit)));

    const rows = await this.db.all<RawAuditPlanSummaryRow>(
      `SELECT
         p.plan_key,
         p.plan_id,
         p.kind,
         p.status,
         COUNT(*) AS event_count,
         MAX(e.occurred_at) AS last_event_at
       FROM plans p
       INNER JOIN planner_events e
         ON e.tenant_id = p.tenant_id
        AND e.plan_id = p.plan_id
       WHERE p.tenant_id = ?
       GROUP BY p.plan_key, p.plan_id, p.kind, p.status
       ORDER BY last_event_at DESC, p.plan_key ASC
       LIMIT ?`,
      [input.tenantId, limit],
    );

    return rows.map((row) => ({
      plan_key: row.plan_key,
      plan_id: row.plan_id,
      kind: row.kind,
      status: row.status,
      event_count: asFiniteNumber(row.event_count),
      last_event_at: row.last_event_at,
    }));
  }
}
