import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChainableEvent } from "../../src/modules/audit/hash-chain.js";
import { verifyChain } from "../../src/modules/audit/hash-chain.js";
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
    const mod:
      | {
        insertPlannerEventNext?: <T>(
          tx: unknown,
          input: {
            replayId: string;
            planId: string;
            occurredAt: string;
            actionJson: string;
            returning: string;
          },
        ) => Promise<{ inserted: T; stepIndex: number }>;
      }
      | null = await import("../../src/modules/planner/planner-events.js").catch(() => null);

    expect(mod).not.toBeNull();
    expect(mod?.insertPlannerEventNext).toBeTypeOf("function");
    if (!mod?.insertPlannerEventNext) return;
    const { insertPlannerEventNext } = mod;

    await db.transaction(async (tx) => {
      await insertPlannerEventNext(tx, {
        replayId: "replay-1",
        planId: "plan-1",
        occurredAt: "2026-02-24T00:00:00.000Z",
        actionJson: JSON.stringify({ type: "test.one" }),
        returning: "*",
      });
      await insertPlannerEventNext<{ id: number }>(tx, {
        replayId: "replay-2",
        planId: "plan-1",
        occurredAt: "2026-02-24T00:00:01.000Z",
        actionJson: JSON.stringify({ type: "test.two" }),
        returning: "id",
      });
    });

    const rows = await db.all<ChainableEvent>(
      "SELECT id, plan_id, step_index, occurred_at, action, prev_hash, event_hash FROM planner_events WHERE plan_id = ? ORDER BY step_index ASC",
      ["plan-1"],
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
    const mod:
      | {
        retryOnUniqueViolation?: <T>(
          attemptFn: (attempt: number) => Promise<T>,
          opts: { maxAttempts?: number; failureMessage: string },
        ) => Promise<T>;
      }
      | null = await import("../../src/modules/planner/planner-events.js").catch(() => null);

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

