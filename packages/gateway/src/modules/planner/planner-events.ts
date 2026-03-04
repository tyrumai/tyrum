import { computeEventHash } from "../audit/hash-chain.js";
import type { SqlDb } from "../../statestore/types.js";
import { isUniqueViolation } from "../../utils/sql-errors.js";

export async function retryOnUniqueViolation<T>(
  attemptFn: (attempt: number) => Promise<T>,
  opts: {
    maxAttempts?: number;
    failureMessage: string;
  },
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await attemptFn(attempt);
    } catch (err) {
      if (isUniqueViolation(err)) {
        continue;
      }
      throw err;
    }
  }

  throw new Error(opts.failureMessage);
}

export async function insertPlannerEventNext<T>(
  tx: SqlDb,
  input: {
    tenantId: string;
    replayId: string;
    planId: string;
    occurredAt: string;
    actionJson: string;
    returning: "*";
  },
): Promise<{ inserted: T; stepIndex: number }> {
  const lastRow = await tx.get<{ step_index: number; event_hash: string | null }>(
    `SELECT step_index, event_hash
     FROM planner_events
     WHERE tenant_id = ? AND plan_id = ?
     ORDER BY step_index DESC
     LIMIT 1`,
    [input.tenantId, input.planId],
  );
  const prevHash = lastRow?.event_hash ?? null;
  const stepIndex = (lastRow?.step_index ?? -1) + 1;
  if (stepIndex < 0) {
    throw new Error("planner_events step_index overflow");
  }

  const eventHash = computeEventHash(
    {
      plan_id: input.planId,
      step_index: stepIndex,
      occurred_at: input.occurredAt,
      action: input.actionJson,
    },
    prevHash,
  );

  const inserted = await tx.get<T>(
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
     RETURNING ${input.returning}`,
    [
      input.tenantId,
      input.planId,
      stepIndex,
      input.replayId,
      input.occurredAt,
      input.actionJson,
      prevHash,
      eventHash,
    ],
  );

  if (!inserted) {
    throw new Error("planner_events insert returned no row");
  }

  return { inserted, stepIndex };
}
