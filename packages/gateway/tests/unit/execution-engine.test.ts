import { afterEach, describe } from "vitest";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { registerEnqueueLifecycleTests } from "./execution-engine.enqueue-lifecycle-test-support.js";
import { registerBudgetPauseTests } from "./execution-engine.budget-pause-test-support.js";
import { registerPolicyEvaluationTests } from "./execution-engine.policy-intent-test-support.js";
import { registerIntentGuardrailTests } from "./execution-engine.intent-guardrail-test-support.js";
import { registerPersistenceTests } from "./execution-engine.persistence-retry-test-support.js";
import { registerRetryCancelTests } from "./execution-engine.retry-cancel-test-support.js";
import { registerRetrySideEffectTests } from "./execution-engine.retry-side-effects-test-support.js";

describe("ExecutionEngine (normalized)", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  const fixture = {
    db: () => {
      db = openTestSqliteDb();
      return db;
    },
  };

  registerEnqueueLifecycleTests(fixture);
  registerBudgetPauseTests(fixture);
  registerPolicyEvaluationTests(fixture);
  registerIntentGuardrailTests(fixture);
  registerPersistenceTests(fixture);
  registerRetryCancelTests(fixture);
  registerRetrySideEffectTests(fixture);
});
