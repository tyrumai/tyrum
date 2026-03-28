import { afterEach, describe, expect, it } from "vitest";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_TENANT_ID,
  DEFAULT_WORKSPACE_ID,
} from "../../src/modules/identity/scope.js";
import { executeWorkboardTool } from "../../src/modules/agent/tool-executor-workboard-tools.js";
import { WorkboardDal } from "../../src/modules/workboard/dal.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

async function insertTurn(params: {
  db: SqliteDb;
  conversationKey: string;
  turnId: string;
  jobId: string;
}): Promise<void> {
  await params.db.run(
    `INSERT INTO turn_jobs (
       tenant_id,
       job_id,
       agent_id,
       workspace_id,
       conversation_id,
       conversation_key,
       status,
       trigger_json,
       latest_turn_id
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      params.jobId,
      DEFAULT_AGENT_ID,
      DEFAULT_WORKSPACE_ID,
      null,
      params.conversationKey,
      "running",
      "{}",
      params.turnId,
    ],
  );
  await params.db.run(
    `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      DEFAULT_TENANT_ID,
      params.turnId,
      params.jobId,
      params.conversationKey,
      "running",
      1,
      "2026-03-20T00:00:00.000Z",
    ],
  );
}

describe("WorkBoard tools and orchestration", () => {
  let db: SqliteDb | undefined;

  afterEach(async () => {
    await db?.close();
    db = undefined;
  });

  it("requests clarification through WorkBoard and sends a steer signal", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const mainConversationKey = "agent:default:test:default:channel:thread-1";
    const requestTurnId = "11111111-1111-4111-8111-111111111111";
    const answerTurnId = "22222222-2222-4222-8222-222222222222";
    const item = await workboard.createItem({
      scope,
      createdFromConversationKey: mainConversationKey,
      item: { kind: "action", title: "Clarification test" },
    });
    await workboard.upsertScopeActivity({
      scope,
      last_active_conversation_key: mainConversationKey,
    });
    const subagent = await workboard.createSubagent({
      scope,
      subagent: {
        work_item_id: item.work_item_id,
        execution_profile: "planner",
        conversation_key: "agent:default:subagent:123e4567-e89b-12d3-a456-426614174111",
        status: "running",
      },
      subagentId: "123e4567-e89b-12d3-a456-426614174111",
    });
    await workboard.createTask({
      scope,
      task: {
        work_item_id: item.work_item_id,
        status: "paused",
        execution_profile: "planner",
        side_effect_class: "workspace",
      },
    });
    await insertTurn({
      db,
      conversationKey: subagent.conversation_key,
      turnId: requestTurnId,
      jobId: "clarification-request-job",
    });
    await insertTurn({
      db,
      conversationKey: mainConversationKey,
      turnId: answerTurnId,
      jobId: "clarification-answer-job",
    });

    const result = await executeWorkboardTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "workboard.clarification.request",
      "tool-call-1",
      { work_item_id: item.work_item_id, question: "Need a concrete API contract?" },
      { work_conversation_key: subagent.conversation_key, execution_turn_id: requestTurnId },
    );

    expect(result?.error).toBeUndefined();
    const row = await db.get<{
      conversation_key: string;
      kind: string;
      message_text: string;
    }>(
      `SELECT conversation_key, kind, message_text
       FROM conversation_queue_signals
       WHERE tenant_id = ?`,
      [DEFAULT_TENANT_ID],
    );
    expect(row?.conversation_key).toBe(mainConversationKey);
    expect(row?.kind).toBe("steer");
    expect(row?.message_text).toContain(item.work_item_id);

    const pausedSubagent = await workboard.getSubagent({
      scope,
      subagent_id: subagent.subagent_id,
    });
    expect(pausedSubagent?.status).toBe("paused");
    const clarificationPhaseAfterRequest = await db.get<{ updated_by_turn_id: string | null }>(
      `SELECT updated_by_turn_id
       FROM work_item_state_kv
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
         AND key = ?`,
      [
        DEFAULT_TENANT_ID,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        item.work_item_id,
        "work.refinement.phase",
      ],
    );
    expect(clarificationPhaseAfterRequest?.updated_by_turn_id).toBe(requestTurnId);

    const clarificationId = JSON.parse(result?.output ?? "{}") as {
      clarification?: { clarification_id?: string };
    };
    const answer = await executeWorkboardTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "workboard.clarification.answer",
      "tool-call-2",
      {
        clarification_id: clarificationId.clarification?.clarification_id,
        answer_text: "Use the internal JSON contract.",
      },
      { work_conversation_key: mainConversationKey, execution_turn_id: answerTurnId },
    );

    expect(answer?.error).toBeUndefined();
    const plannerTasks = await workboard.listTasks({
      scope,
      work_item_id: item.work_item_id,
    });
    expect(
      plannerTasks.some((task) => task.execution_profile === "planner" && task.status === "queued"),
    ).toBe(true);
    const clarificationPhaseAfterAnswer = await db.get<{ updated_by_turn_id: string | null }>(
      `SELECT updated_by_turn_id
       FROM work_item_state_kv
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
         AND key = ?`,
      [
        DEFAULT_TENANT_ID,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        item.work_item_id,
        "work.refinement.phase",
      ],
    );
    expect(clarificationPhaseAfterAnswer?.updated_by_turn_id).toBe(answerTurnId);
  });

  it("uses conversation terminology when clarification target resolution fails", async () => {
    db = openTestSqliteDb();

    await expect(
      executeWorkboardTool(
        {
          workspaceLease: {
            db,
            tenantId: DEFAULT_TENANT_ID,
            agentId: DEFAULT_AGENT_ID,
            workspaceId: DEFAULT_WORKSPACE_ID,
          },
        },
        "workboard.clarification.request",
        "tool-call-missing-clarification-target",
        {
          work_item_id: "55555555-5555-4555-8555-555555555555",
          question: "What conversation should receive this clarification?",
        },
        { work_conversation_key: "agent:default:subagent:123e4567-e89b-12d3-a456-426614174111" },
      ),
    ).rejects.toThrow("unable to resolve clarification target conversation");
  });

  it("persists turn provenance for tool-created artifacts, decisions, and state", async () => {
    db = openTestSqliteDb();
    const workboard = new WorkboardDal(db);
    const scope = {
      tenant_id: DEFAULT_TENANT_ID,
      agent_id: DEFAULT_AGENT_ID,
      workspace_id: DEFAULT_WORKSPACE_ID,
    } as const;
    const item = await workboard.createItem({
      scope,
      createdFromConversationKey: "agent:default:test:default:channel:thread-provenance",
      item: { kind: "action", title: "Turn provenance" },
    });
    const subagentId = "33333333-3333-4333-8333-333333333333";
    const subagent = await workboard.createSubagent({
      scope,
      subagentId,
      subagent: {
        work_item_id: item.work_item_id,
        execution_profile: "planner",
        conversation_key: `agent:default:subagent:${subagentId}`,
        status: "running",
      },
    });
    const turnId = "44444444-4444-4444-8444-444444444444";
    await insertTurn({
      db,
      conversationKey: subagent.conversation_key,
      turnId,
      jobId: "provenance-job",
    });
    const audit = {
      work_conversation_key: subagent.conversation_key,
      execution_turn_id: turnId,
    };

    const artifactResult = await executeWorkboardTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "workboard.artifact.create",
      "tool-call-artifact-provenance",
      {
        work_item_id: item.work_item_id,
        kind: "result_summary",
        title: "Artifact with turn provenance",
      },
      audit,
    );
    const artifactId = (
      JSON.parse(artifactResult?.output ?? "{}") as { artifact?: { artifact_id?: string } }
    ).artifact?.artifact_id;

    const decisionResult = await executeWorkboardTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "workboard.decision.create",
      "tool-call-decision-provenance",
      {
        work_item_id: item.work_item_id,
        question: "Ship it?",
        chosen: "yes",
        rationale_md: "Validated by the active turn.",
      },
      audit,
    );
    const decisionId = (
      JSON.parse(decisionResult?.output ?? "{}") as { decision?: { decision_id?: string } }
    ).decision?.decision_id;

    await executeWorkboardTool(
      {
        workspaceLease: {
          db,
          tenantId: DEFAULT_TENANT_ID,
          agentId: DEFAULT_AGENT_ID,
          workspaceId: DEFAULT_WORKSPACE_ID,
        },
      },
      "workboard.state.set",
      "tool-call-state-provenance",
      {
        scope_kind: "work_item",
        work_item_id: item.work_item_id,
        key: "work.size.class",
        value_json: "small",
      },
      audit,
    );

    const artifactRow = await db.get<{
      created_by_turn_id: string | null;
      created_by_subagent_id: string | null;
    }>(
      `SELECT created_by_turn_id, created_by_subagent_id
       FROM work_artifacts
       WHERE tenant_id = ? AND artifact_id = ?`,
      [DEFAULT_TENANT_ID, artifactId],
    );
    expect(artifactRow).toEqual({
      created_by_turn_id: turnId,
      created_by_subagent_id: subagentId,
    });

    const decisionRow = await db.get<{
      created_by_turn_id: string | null;
      created_by_subagent_id: string | null;
    }>(
      `SELECT created_by_turn_id, created_by_subagent_id
       FROM work_decisions
       WHERE tenant_id = ? AND decision_id = ?`,
      [DEFAULT_TENANT_ID, decisionId],
    );
    expect(decisionRow).toEqual({
      created_by_turn_id: turnId,
      created_by_subagent_id: subagentId,
    });

    const stateRow = await db.get<{ updated_by_turn_id: string | null }>(
      `SELECT updated_by_turn_id
       FROM work_item_state_kv
       WHERE tenant_id = ?
         AND agent_id = ?
         AND workspace_id = ?
         AND work_item_id = ?
         AND key = ?`,
      [
        DEFAULT_TENANT_ID,
        DEFAULT_AGENT_ID,
        DEFAULT_WORKSPACE_ID,
        item.work_item_id,
        "work.size.class",
      ],
    );
    expect(stateRow?.updated_by_turn_id).toBe(turnId);
  });
});
