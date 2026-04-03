import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import type { SqlDb } from "../../src/statestore/types.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { WorkflowRunDal } from "../../src/modules/workflow-run/dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

function createTransactionTrackingDb(input: SqlDb): {
  db: SqlDb;
  getTransactionCount(): number;
  getMaxTransactionDepth(): number;
} {
  let transactionCount = 0;
  let currentDepth = 0;
  let maxDepth = 0;

  const wrap = (db: SqlDb): SqlDb => ({
    kind: db.kind,
    get: async (sql, params) => await db.get(sql, params),
    all: async (sql, params) => await db.all(sql, params),
    run: async (sql, params) => await db.run(sql, params),
    exec: async (sql) => await db.exec(sql),
    close: async () => await db.close(),
    transaction: async (fn) => {
      transactionCount += 1;
      currentDepth += 1;
      maxDepth = Math.max(maxDepth, currentDepth);
      try {
        return await db.transaction(async (tx) => await fn(wrap(tx)));
      } finally {
        currentDepth -= 1;
      }
    },
  });

  return {
    db: wrap(input),
    getTransactionCount: () => transactionCount,
    getMaxTransactionDepth: () => maxDepth,
  };
}

function createPostInsertTimeShiftDb(input: { db: SqlDb; shiftMs: number }): SqlDb {
  const wrap = (db: SqlDb): SqlDb => ({
    kind: db.kind,
    get: async (sql, params) => {
      const result = await db.get(sql, params);
      if (sql.includes("INSERT INTO workflow_runs")) {
        vi.advanceTimersByTime(input.shiftMs);
      }
      return result;
    },
    all: async (sql, params) => await db.all(sql, params),
    run: async (sql, params) => await db.run(sql, params),
    exec: async (sql) => await db.exec(sql),
    close: async () => await db.close(),
    transaction: async (fn) => await db.transaction(async (tx) => await fn(wrap(tx))),
  });

  return wrap(input.db);
}

describe("WorkflowRunDal", () => {
  let db: SqliteDb;
  let dal: WorkflowRunDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    dal = new WorkflowRunDal(db);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.close();
  });

  it("creates a workflow run and round-trips ordered steps", async () => {
    const run = await dal.createRun({
      tenantId: DEFAULT_TENANT_ID,
      agentId: DEFAULT_AGENT_ID,
      workspaceId: DEFAULT_WORKSPACE_ID,
      runKey: "agent:default:automation:default:channel:heartbeat",
      conversationKey: "agent:default:automation:default:channel:heartbeat",
      trigger: {
        kind: "heartbeat",
        metadata: {
          schedule_id: "schedule-heartbeat",
        },
      },
      planId: "plan-heartbeat-1",
      requestId: "req-heartbeat-1",
      input: {
        source: "scheduler",
      },
      budgets: {
        max_duration_ms: 60_000,
      },
      createdAtIso: "2026-04-02T10:00:00Z",
    });

    expect(run.status).toBe("queued");
    expect(run.trigger.kind).toBe("heartbeat");

    const steps = await dal.createSteps({
      tenantId: DEFAULT_TENANT_ID,
      workflowRunId: run.workflow_run_id,
      createdAtIso: "2026-04-02T10:00:01Z",
      steps: [
        {
          action: {
            type: "Http",
            args: {
              url: "https://example.com",
            },
          },
        },
        {
          action: {
            type: "Decide",
            args: {
              tenant_key: "default",
              agent_key: "default",
              workspace_key: "default",
              channel: "automation:heartbeat",
              thread_id: "heartbeat-thread",
              container_kind: "channel",
              parts: [{ type: "text", text: "Handle heartbeat" }],
            },
          },
          timeoutMs: 90_000,
        },
      ],
    });

    expect(steps).toHaveLength(2);
    expect(steps.map((step) => step.step_index)).toEqual([0, 1]);
    expect(steps[1]?.timeout_ms).toBe(90_000);

    const loaded = await dal.getRun({
      tenantId: DEFAULT_TENANT_ID,
      workflowRunId: run.workflow_run_id,
    });
    expect(loaded).toEqual(run);

    const listed = await dal.listSteps({
      tenantId: DEFAULT_TENANT_ID,
      workflowRunId: run.workflow_run_id,
    });
    expect(listed).toHaveLength(2);
    expect(listed[0]?.action.type).toBe("Http");
    expect(listed[1]?.action.type).toBe("Decide");
  });

  it("rolls back run creation when step persistence fails", async () => {
    await expect(
      dal.createRunWithSteps({
        run: {
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
          runKey: "agent:default:main",
          conversationKey: "agent:default:main",
          trigger: {
            kind: "api",
            metadata: {
              conversation_key: "agent:default:main",
            },
          },
          planId: "plan-atomic-1",
          requestId: "req-atomic-1",
        },
        steps: [{ action: { type: "NotARealAction" } }],
      }),
    ).rejects.toThrow();

    const runCount = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workflow_runs WHERE tenant_id = ?",
      [DEFAULT_TENANT_ID],
    );
    expect(runCount?.n).toBe(0);

    const stepCount = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM workflow_run_steps WHERE tenant_id = ?",
      [DEFAULT_TENANT_ID],
    );
    expect(stepCount?.n).toBe(0);
  });

  it("createRunWithSteps uses a single transaction scope", async () => {
    const tracked = createTransactionTrackingDb(db);
    const trackedDal = new WorkflowRunDal(tracked.db);

    const result = await trackedDal.createRunWithSteps({
      run: {
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        runKey: "agent:default:main",
        conversationKey: "agent:default:main",
        trigger: {
          kind: "api",
          metadata: {
            conversation_key: "agent:default:main",
          },
        },
        planId: "plan-single-tx-1",
        requestId: "req-single-tx-1",
      },
      steps: [{ action: { type: "CLI" } }],
    });

    expect(result.steps).toHaveLength(1);
    expect(tracked.getTransactionCount()).toBe(1);
    expect(tracked.getMaxTransactionDepth()).toBe(1);
  });

  it("reuses the created run timestamp for steps when no step timestamp is provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T12:00:00.000Z"));

    const shiftedDal = new WorkflowRunDal(
      createPostInsertTimeShiftDb({
        db,
        shiftMs: 5,
      }),
    );

    const result = await shiftedDal.createRunWithSteps({
      run: {
        tenantId: DEFAULT_TENANT_ID,
        agentId: DEFAULT_AGENT_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        runKey: "agent:default:main",
        conversationKey: "agent:default:main",
        trigger: {
          kind: "api",
          metadata: {
            conversation_key: "agent:default:main",
          },
        },
        planId: "plan-shared-created-at-1",
        requestId: "req-shared-created-at-1",
      },
      steps: [{ action: { type: "CLI" } }],
    });

    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.created_at).toBe(result.run.created_at);
  });
});
