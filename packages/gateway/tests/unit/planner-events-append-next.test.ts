import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChainableEvent } from "../../src/modules/audit/hash-chain.js";
import { verifyChain } from "../../src/modules/audit/hash-chain.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";

describe("planner event append-next helpers", () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = openTestSqliteDb();
  });

  afterEach(async () => {
    await db.close();
  });

  it("inserts next step_index and maintains a valid hash chain", async () => {
    const mod: {
      insertPlannerEventNext?: <T>(
        tx: unknown,
        input: {
          tenantId: string;
          replayId: string;
          planId: string;
          occurredAt: string;
          actionJson: string;
          returning: string;
        },
      ) => Promise<{ inserted: T; stepIndex: number }>;
    } | null = await import("../../src/modules/planner/planner-events.js").catch(() => null);

    expect(mod).not.toBeNull();
    expect(mod?.insertPlannerEventNext).toBeTypeOf("function");
    if (!mod?.insertPlannerEventNext) return;
    const { insertPlannerEventNext } = mod;

    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO plans (
           tenant_id,
           plan_id,
           plan_key,
           agent_id,
           workspace_id,
           kind,
           status
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          DEFAULT_TENANT_ID,
          "plan-1",
          "plan-1",
          DEFAULT_AGENT_ID,
          DEFAULT_WORKSPACE_ID,
          "audit",
          "active",
        ],
      );

      await insertPlannerEventNext(tx, {
        tenantId: DEFAULT_TENANT_ID,
        replayId: "replay-1",
        planId: "plan-1",
        occurredAt: "2026-02-24T00:00:00.000Z",
        actionJson: JSON.stringify({ type: "test.one" }),
        returning: "*",
      });
      await insertPlannerEventNext<{ step_index: number }>(tx, {
        tenantId: DEFAULT_TENANT_ID,
        replayId: "replay-2",
        planId: "plan-1",
        occurredAt: "2026-02-24T00:00:01.000Z",
        actionJson: JSON.stringify({ type: "test.two" }),
        returning: "step_index",
      });
    });

    const rows = await db.all<ChainableEvent>(
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
      [DEFAULT_TENANT_ID, "plan-1"],
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]!.step_index).toBe(0);
    expect(rows[0]!.prev_hash).toBeNull();
    expect(rows[0]!.event_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[1]!.step_index).toBe(1);
    expect(rows[1]!.prev_hash).toBe(rows[0]!.event_hash);
    expect(rows[1]!.event_hash).toMatch(/^[0-9a-f]{64}$/);

    const verification = verifyChain(rows);
    expect(verification.valid).toBe(true);
  });

  it("retries on unique constraint violations", async () => {
    const mod: {
      retryOnUniqueViolation?: <T>(
        attemptFn: (attempt: number) => Promise<T>,
        opts: { maxAttempts?: number; failureMessage: string },
      ) => Promise<T>;
    } | null = await import("../../src/modules/planner/planner-events.js").catch(() => null);

    expect(mod).not.toBeNull();
    expect(mod?.retryOnUniqueViolation).toBeTypeOf("function");
    if (!mod?.retryOnUniqueViolation) return;
    const { retryOnUniqueViolation } = mod;

    let attempts = 0;
    const result = await retryOnUniqueViolation(
      async (attempt) => {
        attempts += 1;
        if (attempt === 0) {
          throw { code: "23505" };
        }
        return "ok";
      },
      { maxAttempts: 2, failureMessage: "exhausted" },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });
});
