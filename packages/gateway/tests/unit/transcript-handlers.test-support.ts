import type { SqliteDb } from "../../src/statestore/sqlite.js";
import {
  createConversationDalFixture,
  setConversationUpdatedAt,
} from "./conversation-dal.test-support.js";

export async function linkSubagentConversation(input: {
  db: SqliteDb;
  tenantId: string;
  conversationId: string;
  conversationKey: string;
  subagentId: string;
  agentId: string;
  workspaceId: string;
  parentConversationKey: string;
  createdAt: string;
  updatedAt?: string;
  status?: string;
}): Promise<void> {
  await input.db.run(
    "UPDATE conversations SET conversation_key = ? WHERE tenant_id = ? AND conversation_id = ?",
    [input.conversationKey, input.tenantId, input.conversationId],
  );
  await input.db.run(
    `INSERT INTO subagents (
       subagent_id,
       tenant_id,
       agent_id,
       workspace_id,
       parent_conversation_key,
       work_item_id,
       work_item_task_id,
       execution_profile,
       conversation_key,
       status,
       desktop_environment_id,
       attached_node_id,
       created_at,
       updated_at,
       last_heartbeat_at,
       closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.subagentId,
      input.tenantId,
      input.agentId,
      input.workspaceId,
      input.parentConversationKey,
      null,
      null,
      "executor",
      input.conversationKey,
      input.status ?? "running",
      null,
      null,
      input.createdAt,
      input.updatedAt ?? input.createdAt,
      null,
      null,
    ],
  );
}

export async function insertRunningExecution(input: {
  db: SqliteDb;
  tenantId: string;
  agentId: string;
  workspaceId: string;
  conversationKey: string;
  conversationId?: string;
  jobId: string;
  turnId: string;
  createdAt: string;
}): Promise<void> {
  await input.db.run(
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
      input.tenantId,
      input.jobId,
      input.agentId,
      input.workspaceId,
      input.conversationId ?? null,
      input.conversationKey,
      "running",
      "{}",
      input.turnId,
    ],
  );
  await input.db.run(
    `INSERT INTO turns (tenant_id, turn_id, job_id, conversation_key, status, attempt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      input.turnId,
      input.jobId,
      input.conversationKey,
      "running",
      1,
      input.createdAt,
    ],
  );
}

export async function insertRunningExecutionTrace(input: {
  db: SqliteDb;
  tenantId: string;
  agentId: string;
  workspaceId: string;
  conversationKey: string;
  conversationId?: string;
  jobId: string;
  turnId: string;
  stepId: string;
  attemptId: string;
  createdAt: string;
}): Promise<void> {
  await insertRunningExecution(input);
  await input.db.run(
    `INSERT INTO workflow_runs (
       workflow_run_id,
       tenant_id,
       agent_id,
       workspace_id,
       run_key,
       status,
       trigger_json,
       created_at
     )
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`,
    [
      input.turnId,
      input.tenantId,
      input.agentId,
      input.workspaceId,
      input.conversationKey,
      JSON.stringify({ kind: "conversation", conversation_key: input.conversationKey }),
      input.createdAt,
    ],
  );
  await input.db.run(
    `INSERT INTO workflow_run_steps (
       tenant_id,
       workflow_run_step_id,
       workflow_run_id,
       step_index,
       status,
       action_json,
       created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      input.stepId,
      input.turnId,
      0,
      "running",
      JSON.stringify({ type: "Research", args: {} }),
      input.createdAt,
    ],
  );
}

export async function insertTranscriptTurnItem(input: {
  db: SqliteDb;
  tenantId: string;
  turnId: string;
  turnItemId: string;
  itemIndex: number;
  itemKey: string;
  createdAt: string;
  messageId: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
}): Promise<void> {
  await input.db.run(
    `INSERT INTO turn_items (
       tenant_id,
       turn_item_id,
       turn_id,
       item_index,
       item_key,
       kind,
       payload_json,
       created_at
     ) VALUES (?, ?, ?, ?, ?, 'message', ?, ?)`,
    [
      input.tenantId,
      input.turnItemId,
      input.turnId,
      input.itemIndex,
      input.itemKey,
      JSON.stringify({
        message: {
          id: input.messageId,
          role: input.role,
          parts: [{ type: "text", text: input.text }],
          metadata: { turn_id: input.turnId },
        },
      }),
      input.createdAt,
    ],
  );
}

export async function createTranscriptFixture() {
  const fixture = createConversationDalFixture();
  const db = fixture.db;
  const subagentId = "550e8400-e29b-41d4-a716-446655440001";

  const root1 = await fixture.dal.getOrCreate({
    connectorKey: "ui",
    providerThreadId: "thread-root-1",
    containerKind: "group",
  });
  const child1 = await fixture.dal.getOrCreate({
    connectorKey: "ui",
    providerThreadId: "thread-child-1",
    containerKind: "group",
  });
  const childConversationKey = `agent:default:subagent:${subagentId}`;
  await linkSubagentConversation({
    db,
    tenantId: child1.tenant_id,
    conversationId: child1.conversation_id,
    conversationKey: childConversationKey,
    subagentId,
    agentId: root1.agent_id,
    workspaceId: root1.workspace_id,
    parentConversationKey: root1.conversation_key,
    createdAt: "2026-02-17T00:00:30.000Z",
  });
  const root2 = await fixture.dal.getOrCreate({
    connectorKey: "ui",
    providerThreadId: "thread-root-2",
    containerKind: "group",
  });
  const root3 = await fixture.dal.getOrCreate({
    connectorKey: "ui",
    providerThreadId: "thread-root-3",
    containerKind: "group",
  });
  const otherTenant = await fixture.dal.getOrCreate({
    scopeKeys: { tenantKey: "tenant-b" },
    connectorKey: "ui",
    providerThreadId: "thread-other-tenant",
    containerKind: "group",
  });

  await setConversationUpdatedAt({
    db,
    tenantId: root1.tenant_id,
    conversationIds: [root1.conversation_id],
    valueSql: "'2026-02-17T00:03:00.000Z'",
  });
  await setConversationUpdatedAt({
    db,
    tenantId: root2.tenant_id,
    conversationIds: [root2.conversation_id],
    valueSql: "'2026-02-17T00:02:00.000Z'",
  });
  await setConversationUpdatedAt({
    db,
    tenantId: root3.tenant_id,
    conversationIds: [root3.conversation_id],
    valueSql: "'2026-02-17T00:01:00.000Z'",
  });

  return {
    db,
    dal: fixture.dal,
    root1,
    child1: { ...child1, conversation_key: childConversationKey },
    root2,
    root3,
    otherTenant,
    subagentId,
  };
}
