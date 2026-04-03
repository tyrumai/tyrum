import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";
import { WorkflowRunDal } from "../../src/modules/workflow-run/dal.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";

describe("WorkflowRunDal", () => {
  let db: SqliteDb;
  let dal: WorkflowRunDal;

  beforeEach(() => {
    db = openTestSqliteDb();
    dal = new WorkflowRunDal(db);
  });

  afterEach(async () => {
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
});
