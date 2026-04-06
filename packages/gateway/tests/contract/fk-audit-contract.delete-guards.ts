import { deleteIds, ids } from "./fk-audit-contract.fixtures.js";

type SeedStatement = {
  sql: string;
  params: readonly unknown[];
};

type SqliteRunner = {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
  };
};

type PostgresClient = {
  query(sql: string, params?: unknown[]): Promise<unknown>;
};

const deleteGuardSeedStatements: SeedStatement[] = [
  {
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            motivation
          ) VALUES (?, ?, ?, ?, ?, 'policy', 'queued', ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.approvalId,
      "approval:fk-audit:delete",
      ids.agentId,
      ids.workspaceId,
      "delete guard approval",
      "delete guard approval",
    ],
  },
  {
    sql: `INSERT INTO policy_overrides (
            tenant_id,
            policy_override_id,
            override_key,
            status,
            agent_id,
            workspace_id,
            tool_id,
            pattern,
            created_from_approval_id,
            created_by_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.policyOverrideId,
      "override:fk-audit:delete",
      ids.agentId,
      ids.workspaceId,
      "connector.send",
      "telegram:work:thread-1",
      deleteIds.approvalId,
      "{}",
      "2026-03-05T10:00:00.000Z",
      "2026-03-05T10:00:00.000Z",
    ],
  },
  {
    sql: `INSERT INTO channel_outbox (
            tenant_id,
            inbox_id,
            source,
            thread_id,
            dedupe_key,
            chunk_index,
            text,
            approval_id,
            workspace_id,
            conversation_id,
            channel_thread_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      1,
      "telegram:work",
      "thread-1",
      "fk-audit:delete-outbox",
      0,
      "hello",
      deleteIds.approvalId,
      ids.workspaceId,
      ids.conversationId,
      ids.channelThreadId,
    ],
  },
  {
    sql: `INSERT INTO turn_jobs (
            tenant_id,
            job_id,
            agent_id,
            workspace_id,
            conversation_key,
            status,
            trigger_json,
            input_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.runJobId,
      ids.agentId,
      ids.workspaceId,
      "fk-audit:delete-run",
      "queued",
      "{}",
      "{}",
    ],
  },
  {
    sql: `INSERT INTO turns (
            tenant_id,
            turn_id,
            job_id,
            conversation_key,
            status,
            attempt
          ) VALUES (?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.turnId,
      deleteIds.runJobId,
      "fk-audit:delete-run",
      "paused",
      1,
    ],
  },
  {
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            motivation,
            turn_id
          ) VALUES (?, ?, ?, ?, ?, 'policy', 'queued', ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.runApprovalId,
      "approval:fk-audit:delete-run",
      ids.agentId,
      ids.workspaceId,
      "delete guard run",
      "delete guard run",
      deleteIds.turnId,
    ],
  },
  {
    sql: `INSERT INTO turn_items (
            tenant_id,
            turn_item_id,
            turn_id,
            item_index,
            item_key,
            kind,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.turnItemId,
      deleteIds.turnId,
      0,
      "message:fk-audit-turn-item",
      "message",
      '{"message":{"id":"msg-fk-audit","role":"assistant","parts":[],"metadata":{"turn_id":"10000000-0000-4000-8000-000000000133","created_at":"2026-03-05T10:00:00.000Z"}}}',
    ],
  },
  {
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            motivation,
            turn_item_id
          ) VALUES (?, ?, ?, ?, ?, 'policy', 'queued', ?, ?, ?)`,
    params: [
      ids.tenantId,
      "10000000-0000-4000-8000-000000000148",
      "approval:fk-audit:delete-turn-item",
      ids.agentId,
      ids.workspaceId,
      "delete guard turn item",
      "delete guard turn item",
      deleteIds.turnItemId,
    ],
  },
  {
    sql: `INSERT INTO workflow_runs (
            tenant_id,
            workflow_run_id,
            agent_id,
            workspace_id,
            run_key,
            status,
            trigger_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.workflowRunId,
      ids.agentId,
      ids.workspaceId,
      "workflow:fk-audit-delete",
      "paused",
      '{"kind":"manual"}',
    ],
  },
  {
    sql: `INSERT INTO workflow_run_steps (
            tenant_id,
            workflow_run_step_id,
            workflow_run_id,
            step_index,
            status,
            action_json
          ) VALUES (?, ?, ?, ?, ?, ?)`,
    params: [ids.tenantId, deleteIds.workflowRunStepId, deleteIds.workflowRunId, 0, "paused", "{}"],
  },
  {
    sql: `INSERT INTO approvals (
            tenant_id,
            approval_id,
            approval_key,
            agent_id,
            workspace_id,
            kind,
            status,
            prompt,
            motivation,
            workflow_run_step_id
          ) VALUES (?, ?, ?, ?, ?, 'policy', 'queued', ?, ?, ?)`,
    params: [
      ids.tenantId,
      deleteIds.workflowApprovalId,
      "approval:fk-audit:delete-workflow-step",
      ids.agentId,
      ids.workspaceId,
      "delete guard workflow step",
      "delete guard workflow step",
      deleteIds.workflowRunStepId,
    ],
  },
];

export function seedSqliteDeleteGuardRows(db: SqliteRunner): void {
  for (const statement of deleteGuardSeedStatements) {
    db.prepare(statement.sql).run(...statement.params);
  }
}

function toPostgresSql(sql: string): string {
  let placeholder = 0;
  return sql.replace(/\?/g, () => `$${String(++placeholder)}`);
}

export async function seedPostgresDeleteGuardRows(client: PostgresClient): Promise<void> {
  for (const statement of deleteGuardSeedStatements) {
    await client.query(toPostgresSql(statement.sql), [...statement.params]);
  }
}
